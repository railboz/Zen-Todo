// Chrome/Opera : service worker sans page de fond -> charge ici les modules partagés (Firefox les a déjà via le manifeste)
// NB : i18n.js doit rester le PREMIER script chargé — il définit `api` (ne pas le redéclarer ici).
if (typeof importScripts === "function") importScripts("i18n.js", "util.js", "sync.js");

let chain = Promise.resolve();
const run = (f) => (chain = chain.then(f).catch(console.error));
const menus = api.menus || api.contextMenus;

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

const projDone = (p) => Array.isArray(p.subs) && p.subs.length > 0 && p.subs.every(x => x.done);

const actionApi = api.action || api.browserAction;   // MV3 : "action", MV2 : "browserAction"

async function updateBadge(tasks, enabled, projects = []) {
  if (!actionApi) return;   // plateforme sans badge (certaines versions Android) : ne pas faire échouer sync()
  const left = enabled ? tasks.filter(x => !x.done) : [];
  const today = localTodayIso();
  const late = left.some(x => x.due && x.due < today) || (enabled && projects.some(p => p.due && p.due < today && !projDone(p)));
  await actionApi.setBadgeText({ text: left.length ? (left.length > 99 ? "99+" : String(left.length)) : "" });
  await actionApi.setBadgeBackgroundColor({ color: late ? "#e5484d" : "#6d4df2" });
  if (actionApi.setBadgeTextColor) await actionApi.setBadgeTextColor({ color: "#ffffff" });
}

async function sync() {
  const s = await api.storage.local.get({ tasks: [], projects: [], notified: {}, lang: null, badge: true });
  s.tasks = uniqueIds((Array.isArray(s.tasks) ? s.tasks : []).map(sanitizeTask).filter(Boolean), "x");
  s.projects = uniqueIds((Array.isArray(s.projects) ? s.projects : []).map(sanitizeProject).filter(Boolean), "p");
  if (!s.notified || typeof s.notified !== "object") s.notified = {};
  setLang(s.lang || defaultLang());
  const now = Date.now();
  const keep = {};
  // Ne supprime QUE les rappels « r:* ». Effacer aussi « gsync » remettait son compteur de 15 min à zéro
  // à chaque modification de tâche : la synchro périodique pouvait alors ne jamais se déclencher.
  const existing = await api.alarms.getAll().catch(() => []);
  for (const a of existing) if (a && typeof a.name === "string" && a.name.startsWith("r:")) { try { await api.alarms.clear(a.name); } catch (e) {} }
  // les projets datés se comportent comme des tâches pour les rappels
  const items = [...s.tasks, ...s.projects.map(p => ({ id: p.id, text: p.name, due: p.due, time: p.time, remind: p.remind, done: projDone(p), updatedAt: p.updatedAt }))];
  for (const tk of items) {
    const f = fireTime(tk);
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
      if (!modifiedAfter && now - f < 24 * 3600 * 1000) { try { await notify(tk); } catch (e) {} } // rappel manqué (< 24 h) : ne doit jamais bloquer la création des alarmes
      keep[tk.id] = f;
    } else {
      api.alarms.create("r:" + tk.id, { when: f });
    }
  }
  // passage à minuit : met à jour le badge (tâches en retard)
  const mid = new Date(); mid.setHours(0, 0, 5, 0);
  if (mid.getTime() <= Date.now()) mid.setDate(mid.getDate() + 1);   // aujourd'hui 00:00:05 si encore à venir, sinon demain
  api.alarms.create("midnight", { when: mid.getTime() });   // idempotent : remplace l'alarme existante
  if (!existing.some(a => a && a.name === "gsync")) api.alarms.create("gsync", { periodInMinutes: 15 });   // pull périodique de la synchronisation Google (ne pas réinitialiser)
  if (JSON.stringify(keep) !== JSON.stringify(s.notified)) await api.storage.local.set({ notified: keep });
  await updateBadge(s.tasks, s.badge, s.projects);
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
api.runtime.onMessage.addListener((m) => {
  if (!m || typeof m.type !== "string") return;
  if (m.type === "zt:signin") run(() => Sync.signInFlow().catch(() => {}));
  if (m.type === "zt:signout") run(() => Sync.signOut().catch(() => {}));
  if (m.type === "zt:dirty") run(() => Sync.markDirty());   // relais : la poussée survit à la fermeture du popup
});

// Rappel périodique : récupère ce qui a changé sur les autres appareils, même popup fermé.
async function gsyncTick() {
  if (!Sync.configured()) return;
  if (!(await Sync.account())) return;
  try { await Sync.syncNow(); } catch (e) {}
}
api.alarms.onAlarm.addListener((a) => {
  if (!a) return;
  // gsync : inutile de reconstruire toutes les alarmes ; si gsyncTick obtient des données,
  // l'écriture dans storage.local déclenche storage.onChanged qui relance sync().
  if (a.name === "gsync") { run(gsyncTick); return; }
  run(sync);
});
api.storage.onChanged.addListener((ch) => {
  if (ch.lang) run(setupMenu);
  if (ch.tasks || ch.projects || ch.lang || ch.badge) run(sync);
});
api.runtime.onStartup.addListener(() => { run(setupMenu); run(sync); });
// Anciennes versions : raccourci du panneau latéral = Alt+Shift+Y ou F2 par défaut. S'il n'a pas été
// personnalisé, il passe à Alt+Shift+Z (F2 interceptait le renommage des pages web, par exemple dans Google Sheets).
async function migrateSidebarShortcut() {
  try {
    const c = (await api.commands.getAll()).find(x => x.name === "_execute_sidebar_action");
    if (c && (c.shortcut === "Alt+Shift+Y" || c.shortcut === "F2")) await api.commands.update({ name: "_execute_sidebar_action", shortcut: "Alt+Shift+Z" });
  } catch (e) {}
}
api.runtime.onInstalled.addListener((details) => {
  run(setupMenu); run(sync);
  if (details && details.reason === "update") run(migrateSidebarShortcut);
});
run(sync);
