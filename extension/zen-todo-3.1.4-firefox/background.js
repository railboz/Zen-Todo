// Chrome/Opera : service worker sans page de fond -> charge ici les modules partagés (Firefox les a déjà via le manifeste)
// NB : i18n.js doit rester le PREMIER script chargé — il définit `api` (ne pas le redéclarer ici).
if (typeof importScripts === "function") importScripts("i18n.js", "util.js", "sync.js");

let chain = Promise.resolve();
const run = (f) => (chain = chain.then(f).catch(console.error));
const menus = api.menus || api.contextMenus;

// Signature de l'état déjà appliqué (alarmes + badge), conservée dans storage.local sous une clé que
// personne d'autre ne lit. Au réveil du worker, un état identique ne coûte qu'une lecture au lieu d'un
// getAll + un clear/création par rappel + 3 badges : c'est ce qui rend l'ouverture du popup instantanée.
const SIG_KEY = "bgSig";
const DEBOUNCE_MS = 100;    // regroupe les écritures d'un même lot (tasks + projects + lang…) en un seul passage
const ALARM_BATCH = 10;     // IPC par paquets : borner la concurrence

// Appelle une méthode de l'API sans jamais interrompre le passage en cours ; renvoie true si elle a réussi.
function settle(fn) {
  try {
    const r = fn();
    return r && typeof r.then === "function" ? r.then(() => true, () => false) : Promise.resolve(true);
  } catch (e) { return Promise.resolve(false); }
}

// Deux FNV-1a (64 bits au total) : une collision ferait sauter une réconciliation d'alarmes.
function stateHash(s) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(36) + "." + b.toString(36) + "." + s.length.toString(36);
}

// Tout ce qui peut changer l'état appliqué : tâches/projets (donc alarmes), rappels déjà traités,
// badge, langue, date locale (retard et alarme de minuit) et rappel échu restant à traiter.
// Ce dernier point est capital : une alarme qui se déclenche popup fermé ne modifie ni la liste ni
// `notified`, seul ce drapeau distingue « rien à faire » de « notification à émettre ».
function buildSig(items, fires, notified, badge, lang, now) {
  let due = 0;
  for (let i = 0; i < items.length && !due; i++) if (fires[i] !== null && notified[items[i].id] !== fires[i] && fires[i] <= now) due = 1;
  const p = [localTodayIso(), badge ? 1 : 0, lang || "", due];
  for (let i = 0; i < items.length; i++) {
    const tk = items[i];
    p.push([tk.id, tk.text, tk.due, tk.time, tk.remind, tk.done ? 1 : 0, tk.updatedAt || 0, fires[i]].join("\u0000"));
  }
  for (const k of Object.keys(notified).sort()) p.push(k + "=" + notified[k]);
  return stateHash(p.join("\u0001"));
}

// scheduledTime (Firefox et Chrome MV3) avec repli sur l'ancien champ `when`.
const alarmTime = (a) => { const t = Number(a.scheduledTime != null ? a.scheduledTime : a.when); return Number.isFinite(t) ? t : NaN; };
const sameTime = (a, b) => Math.abs(a - b) <= 1000;   // tolérance : éviter de recréer sur un arrondi de l'API

function notify(tk) {
  const [y, m, d] = tk.due.split("-").map(Number);
  const [hh, mm] = (tk.time || "09:00").split(":").map(Number);
  const when = new Date(y, m - 1, d, hh, mm).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return api.notifications.create("task-" + tk.id, {
    type: "basic",
    iconUrl: api.runtime.getURL("icons/icon-96.png"),
    title: t("reminderTitle") + " · Zen Todo",
    message: tk.text + "\n" + t("reminderDue", { d: when })
  });
}

const actionApi = api.action || api.browserAction;   // MV3 : "action", MV2 : "browserAction"

// Dernier état réellement écrit dans la barre : ne réécrire que ce qui a changé.
// Cache mémoire volontairement : il disparaît avec le worker, sans conséquence (le badge natif survit
// à l'arrêt du worker) ; onStartup force un passage complet pour le restaurer après un redémarrage.
let badgeState = null;

async function updateBadge(tasks, enabled, projects = [], force = false) {
  if (!actionApi) return;   // plateforme sans badge (certaines versions Android) : ne pas faire échouer sync()
  const left = enabled ? tasks.filter(x => !x.done) : [];
  const today = localTodayIso();
  const late = left.some(x => x.due && x.due < today) || (enabled && projects.some(p => p.due && p.due < today && !isProjectDone(p)));
  const next = {
    text: left.length ? (left.length > 99 ? "99+" : String(left.length)) : "",
    color: late ? "#e5484d" : "#6d4df2",
    textColor: actionApi.setBadgeTextColor ? "#ffffff" : null
  };
  const prev = badgeState;
  if (!force && prev && prev.text === next.text && prev.color === next.color && prev.textColor === next.textColor) return;
  if (force || !prev || prev.text !== next.text) await actionApi.setBadgeText({ text: next.text });
  if (force || !prev || prev.color !== next.color) await actionApi.setBadgeBackgroundColor({ color: next.color });
  if (next.textColor && (force || !prev || prev.textColor !== next.textColor)) await actionApi.setBadgeTextColor({ color: next.textColor });
  badgeState = next;
}

async function sync(force = false) {
  const s = await api.storage.local.get({ tasks: [], projects: [], notified: {}, lang: null, badge: true, bgSig: null });
  s.tasks = parseList(s.tasks, sanitizeTask, "x");
  s.projects = parseList(s.projects, sanitizeProject, "p");
  if (!s.notified || typeof s.notified !== "object") s.notified = {};
  setLang(s.lang || defaultLang());
  const now = Date.now();
  const keep = {};
  // les projets datés se comportent comme des tâches pour les rappels
  const items = [...s.tasks, ...s.projects.map(p => ({ id: p.id, text: p.name, due: p.due, time: p.time, remind: p.remind, done: isProjectDone(p), updatedAt: p.updatedAt }))];
  const fires = items.map(fireTime);
  const sig = buildSig(items, fires, s.notified, s.badge, s.lang, now);
  if (!force && s.bgSig === sig) return;   // rien n'a changé depuis le dernier passage réussi : aucun IPC alarme/badge

  let ok = true;   // un échec d'émission empêche l'écriture de la signature : le passage sera rejoué
  const desired = new Map();   // alarmes « r:<id> » à laisser en place
  for (let i = 0; i < items.length; i++) {
    const tk = items[i], f = fires[i];
    if (f === null) continue;
    if (s.notified[tk.id] === f) { keep[tk.id] = f; continue; }
    if (tk.done) {
      if (f <= now) keep[tk.id] = f;   // occurrence terminée : le rappel ne doit pas repartir au décochage
      continue;
    }
    if (f <= now) {
      // Une tâche créée ou modifiée APRÈS l'heure du rappel ne déclenche pas de notification rétroactive.
      // Cas typique : l'occurrence suivante d'une tâche récurrente, créée à l'instant avec une échéance déjà passée.
      const modifiedAfter = (Number(tk.updatedAt) || 0) > f;
      let sent = true;
      // rappel manqué (< 24 h) : ne doit jamais bloquer la création des alarmes. Si l'émission échoue
      // (notifications coupées au niveau de l'OS, icône illisible…), l'occurrence n'est PAS mémorisée :
      // la signature n'est pas écrite et le passage suivant réessaie. La borne de 24 h arrête les essais.
      if (!modifiedAfter && now - f < 24 * 3600 * 1000) { try { await notify(tk); } catch (e) { sent = false; } }
      if (sent) keep[tk.id] = f; else ok = false;
    } else {
      desired.set("r:" + tk.id, f);
    }
  }
  // Ne touche QUE les rappels « r:* ». Effacer aussi « gsync » remettrait son compteur de 15 min à zéro
  // à chaque modification de tâche : la synchro périodique pourrait alors ne jamais se déclencher.
  const existing = await api.alarms.getAll().catch(() => { ok = false; return []; });
  const scheduled = new Map();
  let hasGsync = false, midnightAt = null;
  for (const a of existing) {
    if (!a || typeof a.name !== "string") continue;
    if (a.name.startsWith("r:")) scheduled.set(a.name, alarmTime(a));
    else if (a.name === "gsync") hasGsync = true;
    else if (a.name === "midnight") midnightAt = alarmTime(a);
  }
  // Différentiel : seuls les rappels disparus, ajoutés ou déplacés coûtent un appel.
  const stale = [...scheduled.keys()].filter(n => !desired.has(n));
  const missing = [...desired].filter(([n, w]) => { const cur = scheduled.get(n); return cur === undefined || !sameTime(cur, w); });
  for (let i = 0; i < stale.length; i += ALARM_BATCH) {
    const r = await Promise.all(stale.slice(i, i + ALARM_BATCH).map(n => settle(() => api.alarms.clear(n))));
    if (r.includes(false)) ok = false;
  }
  for (let i = 0; i < missing.length; i += ALARM_BATCH) {
    const r = await Promise.all(missing.slice(i, i + ALARM_BATCH).map(([n, w]) => settle(() => api.alarms.create(n, { when: w }))));
    if (r.includes(false)) ok = false;
  }
  // passage à minuit : met à jour le badge (tâches en retard)
  const mid = new Date(); mid.setHours(0, 0, 5, 0);
  if (mid.getTime() <= Date.now()) mid.setDate(mid.getDate() + 1);   // aujourd'hui 00:00:05 si encore à venir, sinon demain
  // idempotent : remplace l'alarme existante ; on ne la recrée que si l'heure cible a changé
  if (midnightAt === null || !sameTime(midnightAt, mid.getTime())) {
    if (!(await settle(() => api.alarms.create("midnight", { when: mid.getTime() })))) ok = false;
  }
  // pull périodique de la synchronisation Google (ne pas réinitialiser son compteur)
  if (!hasGsync && !(await settle(() => api.alarms.create("gsync", { periodInMinutes: 15 })))) ok = false;
  await updateBadge(s.tasks, s.badge, s.projects, force);
  // Signature écrite en dernier, et seulement si tout a réussi : un arrêt du worker en cours de passage
  // (ou un appel d'alarme refusé) provoquera un passage complet au réveil suivant, jamais un état
  // à moitié appliqué considéré comme à jour.
  const finalSig = buildSig(items, fires, keep, s.badge, s.lang, now);
  const writes = {};
  if (JSON.stringify(keep) !== JSON.stringify(s.notified)) writes.notified = keep;
  if (ok && s.bgSig !== finalSig) writes[SIG_KEY] = finalSig;
  if (Object.keys(writes).length) await api.storage.local.set(writes);
}

/* ----- clic droit : ajouter le texte sélectionné (absent de Firefox Android) ----- */
async function setupMenu() {
  if (!menus) return;   // Android : pas de menus contextuels
  const s = await api.storage.local.get({ lang: null });
  setLang(s.lang || defaultLang());
  await menus.removeAll();
  const props = { id: "add-to-zen", title: t("menuAdd"), contexts: ["selection"] };
  if (api.menus) props.icons = { 16: "icons/icon-96.png" };   // icônes : Firefox seulement (contextMenus de Chrome ne les gère pas)
  menus.create(props);
}
async function addFromSelection(sel) {
  const text = cleanText(sel, 400).replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text) return;
  const s = await api.storage.local.get({ tasks: [], defaultPriority: "medium", lang: null });
  setLang(s.lang || defaultLang());
  if (!Array.isArray(s.tasks)) s.tasks = [];   // stockage corrompu : repartir d'une liste vide plutôt que planter
  const prio = PRIOS_ALLOWED.includes(s.defaultPriority) ? s.defaultPriority : "medium";
  s.tasks.unshift({
    id: newId(),
    text, priority: prio, repeat: "none", due: null, time: "09:00", remind: "none", done: false, updatedAt: Date.now()
  });
  await api.storage.local.set({ tasks: s.tasks });
  Sync.markDirty();
  api.notifications.create("added", {
    type: "basic", iconUrl: api.runtime.getURL("icons/icon-96.png"), title: "Zen Todo", message: t("menuAdded", { t: text })
  });
}
if (menus) menus.onClicked.addListener((info) => { if (info.menuItemId === "add-to-zen") run(() => addFromSelection(info.selectionText)); });

/* ----- raccourci « zen-sidebar » (Chrome/Opera uniquement : Firefox utilise la commande native _execute_sidebar_action) ----- */
async function toggleSidebar() {
  try {
    if (!api.sidePanel) return;
    const win = await api.windows.getLastFocused();
    await api.sidePanel.open({ windowId: win.id });   // appel direct : le geste utilisateur expire après un await trop long
  } catch (e) {}
}
if (api.commands) api.commands.onCommand.addListener((cmd) => { if (cmd === "zen-sidebar") run(toggleSidebar); });   // Android : api.commands absent

/* ----- reprise du flux OAuth Android après mise en veille de la page de fond ----- */
// Uniquement si identity.launchWebAuthFlow est absent (Firefox Android), donc aucun écouteur
// d'onglets sur desktop. Android n'implémente pas les filtres de tabs.onUpdated : l'URL est
// vérifiée dans le listener, qui ignore tout ce qui n'est pas le retour OAuth.
const needsTabAuth = !(api.identity && api.identity.launchWebAuthFlow);
if (api.tabs && needsTabAuth) {
  api.tabs.onUpdated.addListener((tid, info, tab) => {
    const u = (info && typeof info.url === "string" && info.url) || (tab && typeof tab.url === "string" && tab.url) || "";
    if (u.startsWith(REDIRECT_BASE)) run(() => Sync.resumeTabAuth(tid, u));
  });
  // Pas de listener onRemoved : l'état en attente expire de lui-même après 15 minutes.
}

/* ----- connexion Google : lancée ici (en arrière-plan) pour survivre à la fermeture du popup ----- */
api.runtime.onMessage.addListener((m, sender, sendResponse) => {
  // Seule l'extension elle-même (popup, panneau latéral) peut piloter la synchro : un message venu
  // d'ailleurs ne doit jamais déclencher de flux OAuth ni de poussée Google.
  if (!sender || sender.id !== api.runtime.id) return;
  if (!m || typeof m.type !== "string") return;
  if (m.type === "zt:signin") run(() => Sync.signInFlow().catch(() => {}));
  if (m.type === "zt:signout") run(() => Sync.signOut().catch(() => {}));
  if (m.type === "zt:dirty") run(() => Sync.markDirty());   // relais : la poussée survit à la fermeture du popup
});

// Rappel périodique : récupère ce qui a changé sur les autres appareils, même popup fermé.
async function gsyncTick() {
  if (!Sync.configured()) return;
  if (!(await Sync.account())) return;
  const { syncState } = await api.storage.local.get({ syncState: null });
  if (syncState && syncState.code === "reauth") return;   // évite une fenêtre Google cachée toutes les 15 min
  try { await Sync.syncNow(); } catch (e) {}
}
api.alarms.onAlarm.addListener((a) => {
  if (!a) return;
  // gsync : inutile de reconstruire toutes les alarmes ; si gsyncTick obtient des données,
  // l'écriture dans storage.local déclenche storage.onChanged qui relance sync().
  if (a.name === "gsync") { run(gsyncTick); return; }
  run(sync);
});
// Regroupe en un seul passage les écritures d'un même lot (tasks + projects + lang + badge arrivent
// séparément ou ensemble selon le navigateur). Les clés écrites par sync() lui-même (notified, bgSig)
// ne sont pas surveillées : aucun risque de boucle sur ses propres écritures.
let syncTimer = null;
function scheduleSync() {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; run(sync); }, DEBOUNCE_MS);
}
api.storage.onChanged.addListener((ch) => {
  if (ch.lang) run(setupMenu);
  if (ch.tasks || ch.projects || ch.lang || ch.badge) scheduleSync();
});
// Au démarrage du navigateur les alarmes sont perdues et le badge est effacé : passage complet forcé.
api.runtime.onStartup.addListener(() => { run(setupMenu); run(() => sync(true)); });
// Anciennes versions : raccourci du panneau latéral = Alt+Shift+Y ou F2 par défaut. S'il n'a pas été
// personnalisé, il passe à Alt+Shift+Z (F2 interceptait le renommage des pages web, par exemple dans Google Sheets).
async function migrateSidebarShortcut() {
  try {
    const c = (await api.commands.getAll()).find(x => x.name === "_execute_sidebar_action");
    if (c && (c.shortcut === "Alt+Shift+Y" || c.shortcut === "F2")) await api.commands.update({ name: "_execute_sidebar_action", shortcut: "Alt+Shift+Z" });
  } catch (e) {}
}
api.runtime.onInstalled.addListener((details) => {
  run(setupMenu); run(() => sync(true));   // installation/mise à jour : alarmes recréées, badge restauré
  if (details && details.reason === "update") run(migrateSidebarShortcut);
});
run(sync);
