/* ===== Synchronisation Google Drive (v3.1.4) =====
   - Connexion : OAuth2 via identity.launchWebAuthFlow (flux standard des extensions Firefox).
   - Stockage : fichier zen-todo.json dans la zone privée appDataFolder du Drive de l'utilisateur.
     Seuls l'utilisateur et cette extension peuvent y accéder. Aucun autre serveur.
   - Fusion : par identifiant + horodatage par élément (updatedAt), pierres tombales (90 jours)
     pour les suppressions ; réglages synchronisés en bloc (le plus récent gagne).
   Configuration : renseigner GOOGLE_CLIENT_ID ci-dessous (voir le guide de déploiement). */

const SYNC_FILE = "zen-todo.json";
const GOOGLE_CLIENT_ID = "36194650208-v9rk1d4ia2kve1svkakk69c4pt3klpmf.apps.googleusercontent.com";   // ← ID client OAuth « Application Web » (voir le guide de déploiement)
const SYNC_SCOPES = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
const SYNC_API = "https://www.googleapis.com";
const SYNC_TOMBSTONE_DAYS = 90;                       // les suppressions sont mémorisées 90 jours
const SYNC_FILTERS = ["all", "todo", "done", "today"];
const SYNC_SORTS = ["manual", "date", "priority", "created"];

const DEBUG = false;                    // diagnostics console (Sync.debug / Sync.probe) : coupés dans les paquets publiés
const DUP_WINDOW = 2000;                // cycle lancé moins de 2 s après un cycle réussi = doublon ignoré
const RETRY_BACKOFF = 60000;            // après un échec, pas de nouvelle tentative automatique pendant 60 s

const Sync = {};
const syncChain = { busy: Promise.resolve(), timer: null };   // file d'attente : une synchro à la fois

Sync.configured = () => typeof GOOGLE_CLIENT_ID === "string" && GOOGLE_CLIENT_ID.trim().length > 20;
Sync.available = () => !!(api.identity && api.identity.getRedirectURL && api.identity.launchWebAuthFlow) || !!api.tabs;   // Android : pas d'API identity → flux par onglet

/* ---------- jetons OAuth (flux implicite, sans secret) ---------- */
function randState() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// URL de retour OAuth : Firefox dérive un SHA-1 de l'ID d'extension (identity.getRedirectURL).
// Cette API n'existe pas sur Firefox Android → constante de repli = même valeur calculée pour l'ID
// du manifeste (zen-todo@example.local → hash ci-dessous). À enregistrer dans la console Google.
const redirectURL = () => (api.identity && api.identity.getRedirectURL) ? api.identity.getRedirectURL()
  : "https://89b8af435932f8262889f84ce3398d91f1a1a169.extensions.allizom.org/";
const REDIRECT_BASE = redirectURL();

// Plusieurs comptes Google peuvent être connectés au navigateur : sans indice, prompt=none
// peut choisir le compte par défaut (qui n'a pas autorisé Zen Todo) et échouer. login_hint
// cible le compte qui a réellement autorisé l'extension lors de la connexion.
function authUrl(prompt, state, hint) {
  const params = {
    client_id: GOOGLE_CLIENT_ID.trim(), response_type: "token", redirect_uri: redirectURL(),
    scope: SYNC_SCOPES, prompt, state
  };
  if (hint) params.login_hint = hint;
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams(params).toString();
}

// E-mail du compte autorisé, utilisé comme login_hint pour la renégociation silencieuse.
async function accountHint() {
  try {
    const { gAccount } = await api.storage.local.get({ gAccount: null });
    return (gAccount && typeof gAccount.email === "string") ? gAccount.email : "";
  } catch (e) { return ""; }
}

// Analyse une URL de retour : vérifie l'état anti-CSRF et extrait le jeton.
function parseAuthRedirect(final, state) {
  try {
    const u = new URL(final);
    const h = new URLSearchParams(u.hash.slice(1));
    if ((h.get("state") || u.searchParams.get("state")) !== state) return null;   // anti-CSRF : état inconnu = rejeté
    const token = h.get("access_token");
    const err = h.get("error") || u.searchParams.get("error");
    if (err || !token) return null;
    return { token, expiresAt: Date.now() + Math.max(60, Number(h.get("expires_in")) || 3600) * 1000 };
  } catch (e) { return null; }
}

/* État du flux par onglet (Android) conservé hors mémoire : la page de fond MV3 peut être déchargée
   pendant l'autorisation. storage.session survit à ce redémarrage, pas à la fermeture du navigateur. */
const AUTH_PENDING = "ztPendingTabAuth";
const authStore = () => (api.storage && api.storage.session) ? api.storage.session : api.storage.local;
async function savePendingAuth(p) { try { await authStore().set({ [AUTH_PENDING]: p }); } catch (e) {} }
async function readPendingAuth() { try { const o = await authStore().get({ [AUTH_PENDING]: null }); return o[AUTH_PENDING]; } catch (e) { return null; } }
async function clearPendingAuth() { try { await authStore().remove(AUTH_PENDING); } catch (e) {} }
let activeTabAuth = null;          // flux vivant dans CETTE page de fond (null après un redémarrage)
let lastTabAuthFinish = 0;         // évite de rejouer le retour déjà traité par le flux actif

// Firefox Android n'expose pas identity.launchWebAuthFlow : la page Google s'ouvre dans un onglet
// (forcé au premier plan : Android a tendance à le créer en arrière-plan) et on surveille l'URL de
// retour (https://<hash de l'ID>.extensions.allizom.org/#access_token=...).
// Le fragment (#...) n'est jamais transmis au serveur : le jeton reste côté navigateur.
function tabAuthFlow(prompt, hint) {
  return new Promise((resolve) => {
    const state = randState();
    let tabId = null, settled = false, timer = null;
    // l'arrière-plan est une event page : ces appels limitent la mise en veille ; l'état est de toute façon
    // conservé dans storage.session pour reprendre le flux si la page est malgré tout déchargée.
    const keep = setInterval(() => { try { api.runtime.getPlatformInfo().catch(() => {}); } catch (e) {} }, 15000);
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearInterval(keep);
      clearTimeout(timer);
      try { api.tabs.onUpdated.removeListener(onUpd); api.tabs.onRemoved.removeListener(onRem); } catch (e) {}
      activeTabAuth = null;
      lastTabAuthFinish = Date.now();
      clearPendingAuth();
      if (tabId !== null) api.tabs.remove(tabId).catch(() => {});   // ferme la page Google / page de retour
      resolve(res);
    };
    activeTabAuth = { tabId: null, state };
    savePendingAuth({ state, tabId: null, ts: Date.now() });
    const onUpd = (tid, info, tab) => {
      if (tabId !== null && tid !== tabId) return;
      const u = (info && typeof info.url === "string" && info.url) || (tab && typeof tab.url === "string" && tab.url) || "";
      if (u.startsWith(REDIRECT_BASE)) {
        if (tabId === null) {
          // Retour arrivé avant la résolution de tabs.create : n'accepter que CE flux (état anti-CSRF).
          try {
            const uu = new URL(u), hh = new URLSearchParams(uu.hash.slice(1));
            if ((hh.get("state") || uu.searchParams.get("state")) !== state) return;
          } catch (e) { return; }
          tabId = tid;
        }
        finish(parseAuthRedirect(u, state));
      }
    };
    const onRem = (tid) => { if (tid === tabId) finish(null); };   // onglet fermé sans terminer
    api.tabs.onUpdated.addListener(onUpd);
    api.tabs.onRemoved.addListener(onRem);
    timer = setTimeout(() => finish(null), 300000);   // abandon après 5 min
    // active:true explicite : sur Android, un onglet créé depuis l'extension peut s'ouvrir en arrière-plan
    api.tabs.create({ url: authUrl(prompt, state, hint), active: true }).then((tab) => {
      if (settled) {   // le retour a déjà été traité avant la résolution de tabs.create
        try { if (tab && tab.id != null) api.tabs.remove(tab.id).catch(() => {}); } catch (e) {}
        return;
      }
      tabId = tab.id;
      if (activeTabAuth) activeTabAuth.tabId = tabId;
      savePendingAuth({ state, tabId, ts: Date.now() });
      // ceinture et bretelles : certaines versions d'Android ignorent "active" à la création
      try {
        if (tabId != null && api.tabs.update) {
          const p = api.tabs.update(tabId, { active: true });
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } catch (e) {}
    }, () => finish(null));
  });
}

/* Reprise après déchargement de la page de fond : appelé par background.js sur tabs.onUpdated.
   Si le flux vivait encore dans ce contexte, ses propres listeners ont déjà traité le retour. */
Sync.resumeTabAuth = async (tabId, url) => {
  if (activeTabAuth || Date.now() - lastTabAuthFinish < 10000) return;
  if (!String(url).startsWith(REDIRECT_BASE)) return;
  const p = await readPendingAuth();
  if (!p || !(Number(p.ts) > Date.now() - 15 * 60000)) return;
  if (p.tabId != null && p.tabId !== tabId) return;   // tabId encore inconnu si la page a été déchargée juste après tabs.create
  const res = parseAuthRedirect(url, p.state);
  await clearPendingAuth();
  try { await api.tabs.remove(tabId); } catch (e) {}
  if (!res) { await record("signin"); return; }
  try { await finishSignIn(res); } catch (e) { await record("signin", e && e.message); }
};

// prompt : "select_account" = connexion interactive, "none" = silencieux (session Google déjà ouverte)
async function authFlow(prompt) {
  // Même pour la connexion interactive, pré-sélectionner le compte déjà autorisé évite
  // d'autoriser par erreur un autre compte Google connecté au navigateur.
  const hint = await accountHint();
  if (!(api.identity && api.identity.launchWebAuthFlow)) {
    if (prompt === "none" || !api.tabs) return null;   // Android : renégociation silencieuse impossible → l'utilisateur réappuie sur « Se connecter »
    return tabAuthFlow(prompt, hint);
  }
  const state = randState();
  let final = null;
  try { final = await api.identity.launchWebAuthFlow({ interactive: prompt !== "none", url: authUrl(prompt, state, hint) }); } catch (e) { return null; }
  if (typeof final !== "string") return null;
  return parseAuthRedirect(final, state);
}

async function getToken(force) {
  const { gToken } = await api.storage.local.get({ gToken: null });
  if (!force && gToken && typeof gToken.token === "string" && Number(gToken.expiresAt) - 60000 > Date.now()) return gToken.token;
  const res = await authFlow("none");   // jeton expiré : renégociation silencieuse, sans fenêtre
  if (!res) return null;
  // Renégociation silencieuse (prompt=none) : Google répond avec le compte par défaut du navigateur, qui
  // n'est pas forcément celui qui a autorisé l'extension (login_hint vide après un échec de fetchEmail).
  // Mémoriser un tel jeton écrirait les tâches dans le appDataFolder d'un AUTRE compte : on vérifie donc
  // l'identité du porteur avant de garder quoi que ce soit. Compte enregistré ou identité inconnus = refus.
  const expected = await accountHint();
  const who = await fetchEmail(res.token).catch(() => "");
  if (!expected || !who || who !== expected) { await record("reauth"); return null; }
  await api.storage.local.set({ gToken: res });
  return res.token;
}

Sync.account = async () => {
  if (!Sync.configured()) return null;
  const { gAccount } = await api.storage.local.get({ gAccount: null });
  return (gAccount && typeof gAccount === "object") ? gAccount : null;
};

// { email, status } ; status = 0 quand la requête n'a pas abouti (réseau).
async function userinfo(token) {
  try {
    const r = await fetch(SYNC_API + "/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return { email: "", status: Number(r.status) || 0 };
    const j = await r.json().catch(() => null);
    return { email: j && typeof j.email === "string" ? cleanText(j.email, 80) : "", status: Number(r.status) || 0 };
  } catch (e) { return { email: "", status: 0 }; }
}
async function fetchEmail(token) {
  return (await userinfo(token)).email;
}

/* E-mail du compte après une connexion interactive. Un unique échec transitoire (réseau, 5xx)
   enregistrait auparavant un compte inconnu (e-mail vide), ce qui rendait ensuite toute
   renégociation silencieuse impossible (getToken exige un e-mail connu) jusqu'à une reconnexion
   manuelle. Une seule relance, et seulement si l'erreur est transitoire : 4xx (jeton refusé,
   identité absente) ne changerait pas au second essai. */
const USERINFO_RETRY_MS = 300;
async function fetchEmailRetry(token) {
  let r = await userinfo(token);
  if (r.email || (r.status >= 400 && r.status < 500)) return r.email;
  await new Promise((ok) => setTimeout(ok, USERINFO_RETRY_MS));
  r = await userinfo(token);
  return r.email;
}

/* Fin commune de la connexion : jetons, e-mail, puis première synchronisation.
   E-mail toujours inconnu après la relance : on garde le comportement d'origine (compte inconnu),
   car mémoriser un jeton non rattaché à un compte vérifié casserait l'invariant de getToken. */
async function finishSignIn(res) {
  await api.storage.local.set({ gToken: res, gAccount: { email: "", ts: Date.now() }, lastSync: 0 });
  const email = await fetchEmailRetry(res.token);
  await api.storage.local.set({ gAccount: { email, ts: Date.now() } });
  await doSync(true).catch(() => {});
}

/* Bouton « Se connecter avec Google » (exécuté en arrière-plan pour survivre à la fermeture du popup). */
Sync.signInFlow = async () => {
  try {
    if (!Sync.available() || !Sync.configured()) { await record("nosetup"); return "nosetup"; }
    const res = await authFlow("select_account");
    if (!res) { await record("signin"); return "err"; }   // fenêtre refusée, URI de redirection invalide ou compte refusé
    await finishSignIn(res);
    return "ok";
  } catch (e) {
    await record("signin", e && e.message);   // échec inattendu : rendre l'erreur visible au lieu d'un silence total
    return "err";
  }
};

/* Déconnexion : révoque le jeton côté Google et oublie le compte. Les données locales et du Drive sont conservées. */
Sync.signOut = async () => {
  const { gToken } = await api.storage.local.get({ gToken: null });
  if (gToken && typeof gToken.token === "string") {
    try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(gToken.token), { method: "POST" }); } catch (e) {}
  }
  await api.storage.local.remove(["gToken", "gAccount", "lastSync", "lastAttempt", "syncState", "gFileId"]);
  return "ok";
};

/* ---------- appel API Google avec relance une fois si le jeton a expiré ---------- */
async function record(code, detail) {   // rend le résultat visible dans l'interface (diagnostic)
  const state = { code, time: Date.now() };
  if (detail) state.detail = cleanText(String(detail), 300);
  try { await api.storage.local.set({ syncState: state }); } catch (e) {}
}
// Message d'erreur renvoyé par Google (ex. « Google Drive API has not been used in project… »).
// Sans lui, l'interface ne peut afficher qu'un « Échec de la synchronisation » générique.
async function apiErrorDetail(r) {
  try {
    const txt = await r.text();
    try {
      const j = JSON.parse(txt);
      const e = j && j.error;
      const msg = (e && (e.message || e.status)) || (j && j.error_description) || txt;
      return cleanText(String(msg), 300);
    } catch (e) { return cleanText(txt, 300); }
  } catch (e) { return ""; }
}
async function gfetch(url, opts = {}) {
  const tk = await getToken(false);
  if (!tk) throw new Error("noauth");
  let r = await fetch(url, { ...opts, cache: "no-store", headers: { ...(opts.headers || {}), Authorization: "Bearer " + tk } });
  if (r.status === 401) {
    const tk2 = await getToken(true);
    if (!tk2) throw new Error("noauth");
    r = await fetch(url, { ...opts, cache: "no-store", headers: { ...(opts.headers || {}), Authorization: "Bearer " + tk2 } });
  }
  if (!r.ok) {
    const detail = await apiErrorDetail(r);
    const err = new Error("http:" + r.status);
    if (detail) err.detail = detail;
    throw err;
  }
  return r;
}
const isNetErr = (e) => /NetworkError|Failed to fetch|network/i.test(String((e && e.message) || e));

/* ---------- Drive : recherche, lecture, écriture (zone appDataFolder) ---------- */
async function findFile() {
  const qs = new URLSearchParams({ spaces: "appDataFolder", q: "name = '" + SYNC_FILE + "'",
    fields: "files(id,modifiedTime)", orderBy: "modifiedTime desc", pageSize: "20" }).toString();
  const r = await gfetch(SYNC_API + "/drive/v3/files?" + qs);
  const j = await r.json().catch(() => null);
  const list = j && Array.isArray(j.files) ? j.files : [];
  if (list.length > 1) console.debug("[Zen Todo] " + list.length + " fichiers " + SYNC_FILE + " : le plus récent est utilisé");
  return (list[0] && typeof list[0].id === "string") ? list[0].id : null;
}
function parseSyncDoc(txt) {
  try {
    const v = JSON.parse(txt);
    // JSON valide mais mauvais type (tableau, nombre, null…) : même traitement qu'un contenu illisible
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : { __corrupt: true };
  } catch (e) { return { __corrupt: true }; }   // contenu vide/illisible : signalé, pas d'échec définitif
}
async function readFile(id) {
  const r = await gfetch(SYNC_API + "/drive/v3/files/" + encodeURIComponent(id) + "?alt=media");
  return parseSyncDoc(await r.text());
}
async function uploadFile(id, str) {
  if (id) {
    // mise à jour : l'endpoint d'upload est /upload/drive/v3 (PATCH sur /drive/v3 renverrait 404)
    await gfetch(SYNC_API + "/upload/drive/v3/files/" + encodeURIComponent(id) + "?uploadType=media",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: str });
    return id;
  }
  const b = "zt" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);   // création : métadonnées + contenu
  const body = "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify({ name: SYNC_FILE, parents: ["appDataFolder"] }) +
    "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + str + "\r\n--" + b + "--";
  // fields=id : l'identifiant du fichier créé est mémorisé pour éviter une recherche à chaque cycle
  const r = await gfetch(SYNC_API + "/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body });
  const j = await r.json().catch(() => null);
  return (j && typeof j.id === "string" && j.id) ? j.id : null;
}

/* ---------- normalisation (même discipline que le reste de l'extension) ---------- */
function normDel(d) {
  const out = { t: {}, p: {} };
  const cut = Date.now() - SYNC_TOMBSTONE_DAYS * 86400000;
  for (const kind of ["t", "p"]) {
    const src = d && d[kind] && typeof d[kind] === "object" ? d[kind] : {};
    for (const id in src) {
      const ts = Number(src[id]);
      if (safeId(id) && Number.isFinite(ts) && ts > cut) out[kind][id] = Math.floor(ts);
    }
  }
  return out;
}
function normSet(s) {
  const o = s && typeof s === "object" ? s : {};
  return {
    lang: o.lang == null ? null : (isLang(o.lang) ? o.lang : "en"),
    badge: o.badge !== false,
    sound: o.sound !== false,
    sortBy: SYNC_SORTS.includes(o.sortBy) ? o.sortBy : "manual",
    defaultPriority: PRIOS_ALLOWED.includes(o.defaultPriority) ? o.defaultPriority : "medium",
    filter: SYNC_FILTERS.includes(o.filter) ? o.filter : "all",
    theme: o.theme === "light" ? "light" : "dark",
    ts: Number.isFinite(o.ts) && o.ts > 0 ? Math.floor(o.ts) : 0
  };
}
async function buildLocal() {
  const s = await api.storage.local.get({ tasks: [], projects: [], del: null, setTs: 0, lang: null, badge: true, sound: true, sortBy: "manual", defaultPriority: "medium", filter: "all", theme: "dark" });
  return {
    tasks: parseList(s.tasks, sanitizeTask, "x", 5000),
    projects: parseList(s.projects, sanitizeProject, "p", 500),
    del: normDel(s.del),
    set: normSet({ lang: s.lang, badge: s.badge, sound: s.sound, sortBy: s.sortBy, defaultPriority: s.defaultPriority, filter: s.filter, theme: s.theme, ts: Number(s.setTs) || 0 })
  };
}
function buildDoc(m) { return { v: 1, time: Date.now(), tasks: m.tasks, projects: m.projects, del: m.del, set: m.set }; }

/* ---------- fusion ---------- */
function mergeDel(a, b) {
  const out = { t: { ...a.t }, p: { ...a.p } };
  for (const kind of ["t", "p"]) {
    const src = b[kind] || {};
    for (const id in src) if (!(id in out[kind]) || src[id] > out[kind][id]) out[kind][id] = src[id];
  }
  return normDel(out);   // retrie aussi les pierres tombales devenues trop vieilles
}
// Choix déterministe entre deux versions d'un même élément : updatedAt, puis contenu.
// Le départage par contenu garantit que deux appareils font le MÊME choix même si deux
// modifications tombent dans la même milliseconde (sinon chacun garderait sa version et
// les deux se renverraient le fichier indéfiniment).
function newerItem(a, b) {
  const ta = Number(a.updatedAt) || 0, tb = Number(b.updatedAt) || 0;
  if (ta !== tb) return ta > tb ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function newestMap(list) {
  const map = new Map();
  for (const x of list) {
    const cur = map.get(x.id);
    if (!cur || newerItem(cur, x) === x) map.set(x.id, x);
  }
  return map;
}
// Même départage stable pour le bloc de réglages (un seul horodatage set.ts).
function newerSet(a, b) {
  if (!b) return a;
  if (b.ts !== a.ts) return b.ts > a.ts ? b : a;
  return JSON.stringify(b) >= JSON.stringify(a) ? b : a;
}
// Garde l'ordre local ; les éléments arrivés d'un autre appareil sont placés en tête.
function mergeItems(localList, remoteList, tombs, cap) {
  const lm = newestMap(localList), rm = newestMap(remoteList);
  // Un élément ne disparaît que si une SUPPRESSION (pierre tombale) PLUS RÉCENTE que sa dernière
  // modification existe. Les données d'avant la synchro (sans updatedAt) sont donc toujours gardées
  // tant qu'elles n'ont pas été explicitement supprimées.
  const alive = (x, id) => { const t = tombs[id]; return t === undefined || (Number(x.updatedAt) || 0) > t; };
  const kept = [];
  for (const [id, a] of lm) {
    const b = rm.get(id);
    const pick = b ? newerItem(a, b) : a;
    if (alive(pick, id)) kept.push(pick);
  }
  const fresh = [];
  for (const [id, b] of rm) {
    if (!lm.has(id) && alive(b, id)) fresh.push(b);
  }
  return [...fresh, ...kept].slice(0, cap);
}
function mergeDocs(local, remote) {
  const del = mergeDel(local.del, remote ? normDel(remote.del) : { t: {}, p: {} });
  const rTasks = parseList(remote && remote.tasks, sanitizeTask, "x", 5000);
  const rProjects = parseList(remote && remote.projects, sanitizeProject, "p", 500);
  const rSet = remote ? normSet(remote.set) : null;
  return {
    tasks: mergeItems(local.tasks, rTasks, del.t, 5000),
    projects: mergeItems(local.projects, rProjects, del.p, 500),
    del,
    set: newerSet(local.set, rSet)   // réglages : le bloc le plus récent gagne, départage stable à égalité
  };
}

/* ---------- synchro complète : lecture distante → fusion → écriture locale → envoi ---------- */
// Code d'erreur affiché à l'utilisateur. « noauth » = le jeton n'a pas pu être renouvelé (session Google expirée) ;
// hors ligne, le renouvellement silencieux échoue aussi : on parle alors de réseau, pas de reconnexion.
function syncErrCode(e) {
  const msg = String((e && e.message) || e);
  if (msg === "noauth") return (typeof navigator !== "undefined" && navigator.onLine === false) ? "network" : "reauth";
  return isNetErr(e) ? "network" : "err";
}
// Comparaison insensible à l'ordre des listes ET à l'ordre des clés de tous les objets :
// deux appareils qui n'ordonnent pas leurs tâches ou leurs propriétés de la même façon
// ne doivent pas se réexpédier le fichier à chaque cycle. L'ordre des listes reste local
// à chaque appareil (choix d'affichage, pas une donnée).
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    // Objet sans prototype : une clé « __proto__ » venue d'un document distant y reste une simple clé
    // (l'affecter sur un {} changeait le prototype et la clé disparaissait de la comparaison).
    const out = Object.create(null);
    for (const k of Object.keys(v).sort()) {
      if (RESERVED_IDS.has(k)) continue;   // « __proto__ », « toString »… : jamais comparées, jamais propagées
      out[k] = canon(v[k]);
    }
    return out;
  }
  return v;
}
function canonicalDoc(d) {
  const byId = (list) => (Array.isArray(list) ? list.slice() : []).sort((a, b) => String(a && a.id).localeCompare(String(b && b.id)));
  return JSON.stringify(canon({ v: d && d.v, tasks: byId(d && d.tasks), projects: byId(d && d.projects), del: (d && d.del) || {}, set: d && d.set }));
}
// Un seul cycle à la fois, même entre le popup et l'arrière-plan (deux contextes JS distincts de la même origine) :
// sans ce verrou, deux synchros simultanées pouvaient créer deux fichiers Drive ou s'écraser mutuellement.
// force = true : demande explicite (bouton « Synchroniser », réveil périodique), jamais ignorée comme doublon.
function doSync(force) {
  if (typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function")
    return navigator.locks.request("zen-todo-sync", () => doSyncLocked(force));
  return doSyncLocked(force);
}
/* Identifiant du fichier Drive mémorisé dans storage.local, lié à l'adresse du compte : la recherche
   findFile() (un aller-retour HTTP) n'est plus payée à chaque cycle, et un autre compte ne peut pas
   réutiliser l'identifiant du précédent. L'entrée n'est pas de confiance : un 404/403 la fait recalculer
   et la déconnexion l'efface. Compte inconnu (e-mail vide) : pas de cache, on ne devine jamais. */
async function cachedFileId(email) {
  try {
    if (!email) return null;
    const { gFileId } = await api.storage.local.get({ gFileId: null });
    const c = gFileId;
    return (c && typeof c.id === "string" && c.email === email) ? c.id : null;
  } catch (e) { return null; }
}
async function doSyncLocked(force) {
  if (!Sync.configured()) return "noauth";
  const acct = await Sync.account();
  if (!acct) return "noauth";
  const email = typeof acct.email === "string" ? acct.email : "";
  // Anti-doublon : popup.js et background.js programment chacun un cycle 2,5 s après une modification,
  // soit deux cycles complets (4 GET, 2 lectures locales) pour une seule édition. Le second démarre juste
  // après le premier : ignoré, il ne coûte plus rien. Le verrou garantit que les deux contextes lisent le
  // même lastSync, et lastSync n'est écrit qu'en cas de SUCCÈS : un échec n'est jamais masqué par ce filtre.
  if (!force) {
    const { lastSync: done } = await api.storage.local.get({ lastSync: 0 });
    if (Number(done) && Date.now() - Number(done) < DUP_WINDOW) return "ok";
  }
  await api.storage.local.set({ lastAttempt: Date.now() });   // toute tentative, réussie ou non (backoff de Sync.auto)
  let fileId = await cachedFileId(email), remote = null;
  const cachedId = fileId;
  try {
    if (fileId) {
      try { remote = await readFile(fileId); }
      catch (e) {
        // identifiant périmé (fichier supprimé, droits révoqués) : on refait la recherche, une seule fois
        if (e && (e.message === "http:404" || e.message === "http:403")) { fileId = null; remote = null; }
        else throw e;
      }
    }
    if (!fileId) {
      fileId = await findFile();
      if (fileId) remote = await readFile(fileId);
    }
    // fichier vide/illisible : on repart sur un NOUVEAU fichier plutôt que d'échouer à chaque cycle
    if (remote && remote.__corrupt === true) { fileId = null; remote = null; }
  } catch (e) { const c = syncErrCode(e); await record(c, e && e.detail); return c; }
  if (remote !== null && (typeof remote !== "object" || Array.isArray(remote))) { await record("err"); return "err"; }   // cloud illisible : on ne l'écrase pas
  // L'état local est lu APRÈS l'attente réseau : une modification faite pendant la lecture distante n'est plus écrasée.
  let local = await buildLocal();
  let m = mergeDocs(local, remote);
  const again = await buildLocal();   // dernière vérification juste avant d'écrire
  if (JSON.stringify(again) !== JSON.stringify(local)) { local = again; m = mergeDocs(local, remote); }
  const dataChanged = JSON.stringify(m.tasks) !== JSON.stringify(local.tasks) || JSON.stringify(m.projects) !== JSON.stringify(local.projects);
  const metaChanged = JSON.stringify(m.del) !== JSON.stringify(local.del) || JSON.stringify(m.set) !== JSON.stringify(local.set);
  // filet de sécurité : copie de l'état local seulement si la fusion le modifie (sinon la sauvegarde serait écrasée
  // à chaque synchro, y compris juste après une suppression locale). Restaurable via Options → Données.
  if (dataChanged) await api.storage.local.set({ backup: { time: Date.now(), tasks: local.tasks, projects: local.projects } });
  if (dataChanged || metaChanged) {
    await api.storage.local.set({ tasks: m.tasks, projects: m.projects, del: m.del, setTs: m.set.ts,
      lang: m.set.lang, badge: m.set.badge, sound: m.set.sound, sortBy: m.set.sortBy,
      defaultPriority: m.set.defaultPriority, filter: m.set.filter, theme: m.set.theme });
  }
  const doc = buildDoc(m);
  const out = JSON.stringify(doc);
  // n'écrit sur le Drive que si le contenu (hors horodatage d'écriture et hors ordre des listes) a réellement changé
  const changed = !remote || typeof remote !== "object" || canonicalDoc(doc) !== canonicalDoc(remote);
  if (changed) {
    try { const newId = await uploadFile(fileId, out); if (newId) fileId = newId; }   // création : l'id du nouveau fichier
    catch (e) { const c = syncErrCode(e); await record(c, e && e.detail); return c; }
  }
  const now = Date.now();
  const done = { lastSync: now };   // lastSync sert aussi de repère anti-doublon : écrit seulement en cas de succès
  if (fileId && email && fileId !== cachedId) done.gFileId = { id: fileId, email };   // mémorise l'id sans second aller-retour
  await api.storage.local.set(done);
  await record("ok");
  return "ok";
}

/* Interface publique : synchro immédiate (résultat = "ok" | "network" | "err" | "noauth" | "reauth"). */
Sync.syncNow = () => new Promise((resolve) => {
  // la file ne doit jamais rester rejetée : on récupère une éventuelle erreur avant de chaîner
  syncChain.busy = syncChain.busy.catch(() => {}).then(() => doSync(true)).then(
    (r) => resolve(r),
    (e) => resolve(syncErrCode(e))
  );
});
/* Une modification locale vient d'avoir lieu : pousser après un court délai (regroupe les saisies rapides). */
Sync.markDirty = () => {
  if (!Sync.configured()) return;
  clearTimeout(syncChain.timer);
  syncChain.timer = setTimeout(() => { syncChain.busy = syncChain.busy.then(() => doSync()).catch(() => {}); }, 2500);
};
/* Ouverture de l'interface : récupérer ce qui a pu changer ailleurs, sans relancer le réseau
   à chaque ouverture ni rouvrir une fenêtre Google quand la session est expirée. */
Sync.auto = async () => {
  if (!Sync.configured()) return;
  const { lastSync, lastAttempt, syncState } = await api.storage.local.get({ lastSync: 0, lastAttempt: 0, syncState: null });
  if (syncState && syncState.code === "reauth") return;   // reconnexion manuelle via « Synchroniser »
  if (Date.now() - (Number(lastSync) || 0) < 60000) return;   // synchro récente : ne pas la refaire
  // Dernière tentative en échec (hors ligne, Drive indisponible) : attendre avant de réessayer, sinon chaque
  // ouverture du panneau relançait deux appels HTTP voués à l'échec.
  if (Date.now() - (Number(lastAttempt) || 0) < RETRY_BACKOFF) return;
  syncChain.busy = syncChain.busy.then(() => doSync()).catch(() => {});
};
/* Diagnostic (console de l'arrière-plan) : Sync.debug() — compte les éléments local/distant, sans afficher les textes.
   Désactivé dans les paquets publiés (DEBUG = false) : plus aucune donnée de compte lisible depuis la console
   d'une page d'extension. Le code reste là pour un débogage local (passer DEBUG à true). */
Sync.debug = async () => {
  if (!DEBUG) return null;
  const acct = await Sync.account();
  const { syncState } = await api.storage.local.get({ syncState: null });
  const local = await buildLocal();
  let fileId = null, remote = null, remoteErr = null;
  try {
    fileId = await findFile();
    if (fileId) remote = await readFile(fileId);
  } catch (e) { remoteErr = String((e && (e.detail || e.message)) || e); }
  const sum = (doc) => doc ? {
    tasks: doc.tasks.length, projects: doc.projects.length,
    tasksHorodatees: doc.tasks.filter(x => x.updatedAt).length,
    projetsHorodates: doc.projects.filter(x => x.updatedAt).length,
    tIds: doc.tasks.slice(0, 5).map(x => x.id + (x.updatedAt ? "@" + x.updatedAt : "@0")),
    pIds: doc.projects.slice(0, 5).map(x => x.id + (x.updatedAt ? "@" + x.updatedAt : "@0")),
    setTs: doc.set ? doc.set.ts : null, time: doc.time || null
  } : null;
  const out = {
    compte: acct && acct.email,
    fileId,
    lectureDistante: remoteErr || "ok",
    derniereErreur: syncState,
    local: { tasks: local.tasks.length, projects: local.projects.length,
      tasksHorodatees: local.tasks.filter(x => x.updatedAt).length,
      projetsHorodates: local.projects.filter(x => x.updatedAt).length,
      setTs: local.set.ts, tombales: { t: Object.keys(local.del.t).length, p: Object.keys(local.del.p).length } },
    distant: sum(remote && typeof remote === "object"
      ? { tasks: Array.isArray(remote.tasks) ? remote.tasks : [], projects: Array.isArray(remote.projects) ? remote.projects : [], set: remote.set, time: remote.time }
      : null)
  };
  console.log("[Zen Todo][debug]", out);
  return out;
};
/* Diagnostic écriture (console de l'arrière-plan) : Sync.probe() — crée, modifie, relit puis supprime
   un fichier test zen-todo-probe.json dans la zone privée. Ne touche pas au fichier de synchronisation.
   Désactivé dans les paquets publiés (DEBUG = false), comme Sync.debug(). */
Sync.probe = async () => {
  if (!DEBUG) return null;
  const out = {};
  try {
    const tk = await getToken(false);
    if (!tk) throw new Error("noauth");
    const b = "ztprobe";
    const meta = { name: "zen-todo-probe.json", parents: ["appDataFolder"] };
    const body = "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify({ probe: Date.now() }) + "\r\n--" + b + "--";
    const cr = await fetch(SYNC_API + "/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", cache: "no-store", headers: { Authorization: "Bearer " + tk, "Content-Type": "multipart/related; boundary=" + b }, body });
    out.create = cr.ok ? "ok" : "http:" + cr.status;
    if (!cr.ok) { out.detail = await cr.text().then(t => t.slice(0, 300)).catch(() => ""); console.log("[Zen Todo][probe]", out); return out; }
    const id = (await cr.json()).id;
    const pr = await fetch(SYNC_API + "/upload/drive/v3/files/" + encodeURIComponent(id) + "?uploadType=media",
      { method: "PATCH", cache: "no-store", headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" }, body: JSON.stringify({ probe: 2 }) });
    out.update = pr.ok ? "ok" : "http:" + pr.status;
    if (!pr.ok) out.detail = await pr.text().then(t => t.slice(0, 300)).catch(() => "");
    const gr = await fetch(SYNC_API + "/drive/v3/files/" + encodeURIComponent(id) + "?alt=media",
      { cache: "no-store", headers: { Authorization: "Bearer " + tk } });
    out.readBack = gr.ok ? (await gr.text()) : "http:" + gr.status;
    const dr = await fetch(SYNC_API + "/drive/v3/files/" + encodeURIComponent(id),
      { method: "DELETE", cache: "no-store", headers: { Authorization: "Bearer " + tk } });
    out.delete = (dr.ok || dr.status === 204) ? "ok" : "http:" + dr.status;
  } catch (e) { out.erreur = String((e && e.message) || e); }
  console.log("[Zen Todo][probe]", out);
  return out;
};
