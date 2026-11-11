const PRIOS = ["low", "medium", "high"];
const REMINDS = ["none", "0", "10", "60", "1440"];

let tasks = [];
let defaultPriority = "medium";
let editingId = null;
let dragId = null;
let savedTimer = null, toastTimer = null;
let query = "";
let lastDeleted = null;
let enterId = null, doneId = null, lastLeft = null;
let sortBy = "manual";
let soundOn = true;
let undoFn = null;
let filter = "all";
let syncDel = { t: {}, p: {} };   // pierres tombales de suppression (synchronisation)
let setTs = 0;                    // horodatage des réglages synchronisés
const FILTERS = ["all", "todo", "done", "today"];
const SORTS = SYNC_SORTS;   // source unique : sync.js (whitelist utilisée pour la synchronisation des réglages)
const isSidebar = document.documentElement.classList.contains("is-sidebar");
const IS_ANDROID = document.documentElement.classList.contains("android");
let projects = [];
let currentTab = "tasks", inSettings = false;
let editingProject = null, editingSub = null, focusSubFor = null;
let enterProj = null, enterSub = null, doneSub = null;
let pendingTasks = null, pendingProjects = null;   // changements reçus (synchro) pendant une édition : appliqués à la fin pour ne pas perdre la saisie
const lastPct = {};
const completing = new Set();   // évite de créer deux occurrences si on double-clique sur une tâche récurrente
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Formulaires d'édition réutilisés d'un rendu à l'autre : une reconstruction de liste ne doit
// pas perdre la saisie en cours (filtre, recherche, tri, ajout, changement d'onglet).
let editNodeCache = null, projectEditCache = null, subEditCache = null;
const subDrafts = new Map();   // brouillon du champ « ajouter une sous-tâche », par projet

// Mémorise l'élément actif et sa sélection avant de reconstruire une liste, puis le restaure.
function captureFocus() {
  const a = document.activeElement;
  const sel = (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) ? [a.selectionStart, a.selectionEnd] : null;
  return { el: a, sel };
}
function restoreFocus(f) {
  if (!f || !f.el || !f.el.isConnected || f.el === document.activeElement) return;
  try {
    f.el.focus({ preventScroll: true });
    if (f.sel) f.el.setSelectionRange(f.sel[0], f.sel[1]);
  } catch (e) {}
}

/* ---------- sons légers (Web Audio) ---------- */
let audioCtx = null;
function playSound(type) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new window.AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    const notes = (type === "done") ? [[880, 0], [1318.5, 0.08]]
      : type === "add" ? [[659.25, 0], [987.77, 0.07]]
      : [[523.25, 0]];
    for (const [freq, off] of notes) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      const s = t + off;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.14, s + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.start(s); o.stop(s + 0.2);
    }
  } catch (e) {}
}

const $ = (id) => document.getElementById(id);
const list = $("list");
// SEC-10 : les identifiants lus dans le stockage sont déjà contraints par safeId(), mais une
// valeur n'est jamais concaténée brute dans un sélecteur CSS : on l'échappe (une donnée
// inattendue ne peut pas viser un autre nœud que celui voulu).
const cssEsc = (s) => (typeof CSS !== "undefined" && typeof CSS.escape === "function")
  ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&");
const SVG = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4z"/><path d="M14 4v6h6"/></svg>'
};

const el = mk;
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function todayIso() { const n = new Date(); return toIso(n.getFullYear(), n.getMonth(), n.getDate()); }

function buildSelect(sel, values, prefix) {
  const cur = sel.value;
  sel.replaceChildren(...values.map(v => new Option(t(prefix + v), v)));
  if (values.includes(cur)) sel.value = cur;
}
// Remplissage mémoïsé (langue + options) : une liste de tâches ne reconstruit plus les <select>
// de la vue Options à chaque rendu. Mêmes options pour la même clé, donc DOM identique.
const selectKeys = new WeakMap();
function buildSelectCached(sel, values, prefix) {
  const key = LANG + "|" + prefix + "|" + values.join(",");
  if (selectKeys.get(sel) === key) return;
  selectKeys.set(sel, key);
  buildSelect(sel, values, prefix);
}
function sortByCmp(a, b) {
  if (sortBy === "date") return (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31");
  if (sortBy === "priority") return (PRIOS.indexOf(b.priority) - PRIOS.indexOf(a.priority)) || 0;
  if (sortBy === "created") return (b.id || "").localeCompare(a.id || "");
  return 0;
}

function persist() {
  pendingTasks = null;   // l'état en mémoire fait foi dès qu'on l'enregistre
  for (const x of tasks) { x.text = cleanText(x.text, 200); if (typeof x.note === "string") x.note = cleanText(x.note, 500); }
  Sync.markDirty();
  api.storage.local.set({ tasks }).then(() => {
    const s = $("saved");
    s.classList.add("show");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => s.classList.remove("show"), 1200);
  });
}

/* ---------- synchronisation : réglages touchés, suppressions mémorisées ---------- */
function touchSettings() { setTs = Date.now(); api.storage.local.set({ setTs }); Sync.markDirty(); }
function tombstone(kind, id) { if (!safeId(id)) return; syncDel[kind][id] = Date.now(); api.storage.local.set({ del: syncDel }); }
function untombstone(kind, id) { if (!safeId(id) || !syncDel[kind]) return; delete syncDel[kind][id]; api.storage.local.set({ del: syncDel }); }
// SEC-09 : l'objet `del` lu dans le stockage passe par normDel() (sync.js) — validation stricte des
// identifiants et purge des pierres tombales expirées — au lieu d'être recopié tel quel.
// Garde `typeof` : hors navigateur (test), sync.js peut être absent.
function readDel(d) {
  if (typeof normDel === "function") return normDel(d);
  return (d && typeof d === "object") ? { t: (d.t && typeof d.t === "object") ? d.t : {}, p: (d.p && typeof d.p === "object") ? d.p : {} } : { t: {}, p: {} };
}

// Si l'heure du rappel est déjà passée à l'enregistrement, on évite une notification immédiate.
async function markPast(task) {
  const f = fireTime(task);
  if (f === null || f > Date.now()) return;
  const { notified } = await api.storage.local.get({ notified: {} });
  notified[task.id] = f;
  await api.storage.local.set({ notified });
}

function formatDue(iso) {
  if (iso === todayIso()) return t("today");
  const d = new Date(); d.setDate(d.getDate() + 1);
  if (iso === toIso(d.getFullYear(), d.getMonth(), d.getDate())) return t("tomorrow");
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}
function isLate(task) { return !!task.due && !task.done && task.due < todayIso(); }

/* ---------- récurrence ---------- */
function validDay(n) { n = Number(n); return Number.isInteger(n) && n >= 1 && n <= 31; }
// Jour d'ancrage d'une tâche mensuelle : 31 janv. → 28 févr. → 31 mars (et non 28 mars).
function monthlyAnchor(task) {
  if (validDay(task && task.repeatDay)) return Number(task.repeatDay);
  if (task && task.due) { const d = Number(task.due.slice(8, 10)); if (validDay(d)) return d; }
  return new Date().getDate();
}
function nextDueIso(task) {
  const base = task.due ? task.due.split("-").map(Number) : null;
  const t0 = new Date(); const today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
  const origDay = validDay(task.repeatDay) ? Number(task.repeatDay) : (base ? base[2] : today.getDate());
  let d = base ? new Date(base[0], base[1] - 1, base[2]) : new Date(today);
  const step = () => {
    if (task.repeat === "daily") d.setDate(d.getDate() + 1);
    else if (task.repeat === "weekly") d.setDate(d.getDate() + 7);
    else {
      const y = d.getFullYear(), m = d.getMonth() + 1;
      d = new Date(y, m, Math.min(origDay, new Date(y, m + 1, 0).getDate()));
    }
  };
  step();
  while (d < today) step();
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ---------- annuler la suppression ---------- */
function showToast(msg, fn) {
  undoFn = fn || null;
  $("toast-msg").textContent = msg;
  $("toast-undo").textContent = t("undo");
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() { $("toast").hidden = true; lastDeleted = null; undoFn = null; clearTimeout(toastTimer); }
function removeTasks(ids) {
  const lis = [...list.querySelectorAll(".task")].filter(li => ids.has(li.dataset.id));
  if (lis.length && !reduceMotion()) {
    lis.forEach(li => li.classList.add("leaving"));
    setTimeout(() => doRemove(ids), 190);
  } else doRemove(ids);
}
function doRemove(ids) {
  const items = [];
  tasks.forEach((tk, i) => { if (ids.has(tk.id)) items.push({ tk, i }); });
  if (!items.length) return;
  items.forEach(({ tk }) => tombstone("t", tk.id));   // la suppression doit se propager aux autres appareils
  tasks = tasks.filter(x => !ids.has(x.id));
  if (editingId && ids.has(editingId)) editingId = null;   // la tâche éditée vient d'être supprimée (ex. « Effacer les terminées »)
  lastDeleted = items;
  persist(); render();
  showToast(items.length === 1 ? t("taskDeleted") : t("tasksDeleted", { n: items.length }));
  // HIG : après une suppression, le focus doit rester dans la liste (ou revenir à l'action d'ajout).
  // Sur Android, viser le champ texte rouvrirait le clavier : on vise le bouton « Ajouter ».
  const next = list.querySelector(".task .check") || (IS_ANDROID ? $("add-btn") : $("new-text"));
  if (next) { try { next.focus({ preventScroll: true }); } catch (e) { try { next.focus(); } catch (e2) {} } }
}
$("toast-undo").addEventListener("click", () => {
  if (undoFn) { const f = undoFn; hideToast(); f(); return; }
  if (!lastDeleted) return;
  const now = Date.now();
  lastDeleted.sort((a, b) => a.i - b.i).forEach(({ tk, i }) => {
    untombstone("t", tk.id); tk.updatedAt = now;   // restaurée plus récemment que sa suppression : elle gagne
    tasks.splice(Math.min(i, tasks.length), 0, tk);
  });
  hideToast(); persist(); render();
});

/* ---------- affichage ---------- */
/* ---------- filtres ---------- */
const FILTER_TESTS = {
  all: () => true,
  todo: (x) => !x.done,
  done: (x) => !!x.done,
  today: (x) => !x.done && !!x.due && x.due <= todayIso()   // aujourd'hui + en retard
};
function matchesFilter(x) { return FILTER_TESTS[filter](x); }
let filtersKey = null;
function renderFilters() {
  const box = $("filters");
  box.hidden = tasks.length === 0;
  // Un seul passage sur les tâches (au lieu d'un filter par pastille) ; les compteurs suffisent
  // comme clé : à clé égale, les pastilles seraient identiques.
  const counts = { all: 0, todo: 0, done: 0, today: 0 };
  const today = todayIso();
  for (const x of tasks) {
    counts.all++;
    if (x.done) counts.done++;
    else { counts.todo++; if (x.due && x.due <= today) counts.today++; }
  }
  const key = LANG + "|" + filter + "|" + counts.all + "|" + counts.todo + "|" + counts.done + "|" + counts.today;
  if (key === filtersKey) return;
  filtersKey = key;
  box.replaceChildren(...FILTERS.map(f => {
    const b = el("button", "fchip"); b.type = "button"; b.setAttribute("aria-pressed", String(f === filter));
    const l = el("span"); l.textContent = t("filter_" + f);
    const n = el("b"); n.textContent = counts[f];
    b.append(l, n);
    b.addEventListener("click", () => { filter = f; api.storage.local.set({ filter }); touchSettings(); render(); });
    return b;
  }));
}

/* ---------- robustesse : données incomplètes ou modifiées à la main ---------- */
function normTasks(a) { return uniqueIds((Array.isArray(a) ? a : []).slice(0, 5000).map(sanitizeTask).filter(Boolean), "x"); }
function normProjects(a) { return uniqueIds((Array.isArray(a) ? a : []).slice(0, 500).map(sanitizeProject).filter(Boolean), "p"); }

/* ---------- travail différé d'après rendu ---------- */
/* Une seule paire de requestAnimationFrame par rendu : plus de lecture de offsetWidth au milieu
   de la construction de la liste (elle forçait une mise en page synchrone) et plus d'une paire
   de rAF par projet. Les travaux s'exécutent dans l'ordre où ils ont été demandés. */
const afterPaintJobs = [];
let afterPaintFrame = 0;
function afterPaint(fn) {
  afterPaintJobs.push(fn);
  if (afterPaintFrame) return;
  afterPaintFrame = requestAnimationFrame(() => {
    // Frame suivante : le navigateur a calculé les styles de départ (sans .bump, largeur = lastPct)
    // avant qu'on ne les change — l'animation et la transition redémarrent comme avant.
    afterPaintFrame = requestAnimationFrame(() => {
      afterPaintFrame = 0;
      for (const job of afterPaintJobs.splice(0)) { try { job(); } catch (e) {} }
    });
  });
}
// Barres de progression des projets : largeur finale calculée dans le même lot différé.
const barJobs = [];
let barFlushQueued = false;
function queueBarFill(fill, pct) {
  barJobs.push([fill, pct]);
  if (barFlushQueued) return;
  barFlushQueued = true;
  afterPaint(() => {
    barFlushQueued = false;
    for (const [f, v] of barJobs.splice(0)) f.style.width = v + "%";
  });
}

function render() {
  if (!editingId) editNodeCache = null;   // édition terminée : ne pas garder un formulaire fantôme
  if (!editingId && pendingTasks) { tasks = normTasks(pendingTasks); pendingTasks = null; }
  const focus = currentTab === "projects" ? null : captureFocus();   // en vue projets, renderProjects gère le focus
  const done = tasks.filter(x => x.done).length;
  const leftNow = tasks.length - done;
  $("left").textContent = leftNow;
  // Redémarrage de l'animation « bump » sans lire offsetWidth (aucune mise en page forcée) :
  // la classe est retirée maintenant et remise après la frame de peinture.
  if (lastLeft !== null && lastLeft !== leftNow) { $("left").classList.remove("bump"); afterPaint(() => $("left").classList.add("bump")); }
  lastLeft = leftNow;
  $("subtitle").textContent = tasks.length ? t("tasksCount", { n: tasks.length, d: done }) : t("emptySub");
  $("clear").disabled = done === 0;
  $("clear").style.opacity = done === 0 ? .5 : 1;

  // Vue Options (masquée pendant un rendu de liste) : reconstruite seulement si ses entrées changent.
  buildSelectCached($("new-priority"), PRIOS, "");
  renderPrioChips();
  renderFilters();

  const q = norm(query.trim());
  const filtered = filter !== "all";
  let shown = tasks.filter(x => (!q || norm(x.text).includes(q)) && matchesFilter(x));
  // La tâche en cours d'édition reste toujours visible, même si un filtre ou une recherche
  // ne correspond plus : sinon son formulaire disparaîtrait au milieu de la saisie.
  if (editingId) {
    const ed = tasks.find(x => x.id === editingId);
    if (ed && !new Set(shown.map(x => x.id)).has(ed.id)) shown = [ed, ...shown];
  }
  const sorting = !q && sortBy !== "manual";
  if (sorting) shown = shown.slice().sort(sortByCmp);

  buildSelectCached($("sort-select"), SORTS, "sort_");
  $("sort-select").value = sortBy;
  buildSelectCached($("sort-select-settings"), SORTS, "sort_");
  $("sort-select-settings").value = sortBy;

  $("search-box").hidden = tasks.length === 0;
  $("search-clear").hidden = query === "";
  $("empty").hidden = tasks.length > 0;
  $("no-results").hidden = !(tasks.length > 0 && shown.length === 0);
  list.hidden = shown.length === 0;
  list.replaceChildren();

  if (q || filtered || sorting) {
    // N² → N : index construit une fois au lieu d'un tasks.indexOf() par tâche affichée.
    const indexById = new Map();
    tasks.forEach((x, i) => indexById.set(x.id, i));
    shown.forEach(task => list.appendChild(taskNode(task, indexById.get(task.id), false)));
  } else {
    const late = [], normal = [];
    tasks.forEach((task, idx) => { (isLate(task) ? late : normal).push([task, idx]); });
    if (late.length) list.appendChild(el("li", "group-title late", t("lateSection") + " (" + late.length + ")"));
    late.forEach(([task, idx]) => list.appendChild(taskNode(task, idx, true)));
    if (late.length && normal.length) list.appendChild(el("li", "group-title", t("otherSection")));
    normal.forEach(([task, idx]) => list.appendChild(taskNode(task, idx, true)));
  }
  enterId = null; doneId = null;
  if (currentTab === "projects") renderProjects(); else updateHeader();
  restoreFocus(focus);
  syncSheet();
}

function taskNode(task, i, canReorder) {
  const li = el("li", `task p-${task.priority}${task.done ? " done" : ""}`);
  li.dataset.id = task.id;
  if (task.id === enterId) li.classList.add("enter");
  if (task.id === doneId) li.classList.add("just-done");

  const handle = el("span", "handle", "⋮⋮");
  handle.setAttribute("aria-hidden", "true");
  if (!canReorder) handle.style.visibility = "hidden";
  li.appendChild(handle);
  // Délégation : un seul jeu d'écouteurs sur #list (voir plus bas). `reorderable` tient le rôle
  // qu'avait la présence des écouteurs par ligne — sans ajouter d'attribut au DOM.
  if (canReorder) reorderable.add(li);

  if (editingId === task.id) {
    if (!editNodeCache || editNodeCache.id !== task.id) editNodeCache = { id: task.id, node: editNode(task) };
    li.appendChild(editNodeCache.node);
    return li;
  }

  const check = el("button", "check", SVG.check);
  check.type = "button";
  check.title = task.done ? t("markUndone") : t("markDone");
  check.setAttribute("aria-label", check.title);
  li.appendChild(check);

  const body = el("div", "body");
  const top = el("div", "top");
  const text = el("span", "text"); text.textContent = task.text;
  const badge = el("span", "badge"); badge.textContent = t(task.priority);
  top.append(text, badge);
  body.append(top);
  if (task.note && task.note.trim()) { const nd = el("div", "note"); const ni = el("span", "ico", SVG.note); const nt = el("span"); nt.textContent = task.note; nd.append(ni, nt); body.append(nd); }

  const bottom = el("div", "bottom");
  const up = mini(SVG.up, t("moveUp")); up.disabled = !canReorder || neighborIndex(i, -1) < 0;
  const down = mini(SVG.down, t("moveDown")); down.disabled = !canReorder || neighborIndex(i, 1) < 0;
  const edit = mini(SVG.edit, t("edit"));
  edit.classList.add("edit-btn");
  bottom.append(up, down, edit);


  const hasRepeat = task.repeat && task.repeat !== "none";
  const hasRemind = task.remind && task.remind !== "none" && task.due;
  if (task.due || hasRepeat) {
    const due = el("span", "due" + (isLate(task) ? " late" : ""));
    if (hasRepeat) { const r = el("span", "ico", SVG.repeat); r.title = t("repeat_" + task.repeat); due.appendChild(r); }
    if (hasRemind) { const b = el("span", "ico", SVG.bell); b.title = t("remind_" + task.remind); due.appendChild(b); }
    if (task.due) {
      const s = el("span"); s.textContent = formatDue(task.due) + (hasRemind ? " · " + (task.time || "09:00") : "");
      due.appendChild(s);
    }
    bottom.appendChild(due);
  }
  body.append(bottom);
  li.appendChild(body);

  const del = el("button", "del", SVG.trash);
  del.type = "button"; del.title = t("del"); del.setAttribute("aria-label", t("del"));
  li.appendChild(del);
  return li;
}

/* ---------- délégation des événements de la liste ---------- */
/* 6 écouteurs sur #list au lieu de 11 par tâche (1100 créations par rendu à N=100). Chaque
   gestionnaire retrouve la ligne par closest("li.task") au moment de l'événement. */
const reorderable = new WeakSet();   // lignes construites avec canReorder (aucun attribut DOM en plus)
const taskById = (id) => tasks.find(x => x.id === id) || null;
const inList = (target) => (target && target.closest) ? target.closest("li.task") : null;

list.addEventListener("click", (e) => {
  const li = inList(e.target);
  if (!li) return;
  // Clic sur la poignée sans glisser : la ligne ne doit pas rester déplaçable (ex-écouteur « mouseup »).
  if (e.target.closest(".handle")) { li.draggable = false; return; }
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = li.dataset.id;
  if (btn.classList.contains("check")) { const task = taskById(id); if (task) completeToggle(task); return; }
  if (btn.classList.contains("del")) { removeTasks(new Set([id])); return; }
  if (btn.classList.contains("edit-btn")) { editingId = id; render(); return; }
  if (btn.classList.contains("mini")) {
    const i = tasks.findIndex(x => x.id === id);
    if (i < 0) return;
    // `.bottom` contient [monter, descendre, modifier, échéance] : les deux flèches n'ont pas de
    // classe propre (le DOM ne doit pas changer), c'est leur position qui les distingue.
    move(i, btn.parentElement && btn.parentElement.firstElementChild === btn ? -1 : 1);
  }
});
list.addEventListener("mousedown", (e) => {
  if (!e.target.closest || !e.target.closest(".handle")) return;
  const li = inList(e.target);
  if (li && reorderable.has(li)) li.draggable = true;
});
list.addEventListener("dragstart", (e) => {
  const li = inList(e.target);
  if (!li || !reorderable.has(li)) return;
  dragId = li.dataset.id; li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});
list.addEventListener("dragend", (e) => {
  const li = inList(e.target);
  if (!li || !reorderable.has(li)) return;
  li.draggable = false; dragId = null; clearDrop(); li.classList.remove("dragging");
});
list.addEventListener("dragover", (e) => {
  const li = inList(e.target);
  if (!li || !dragId || dragId === li.dataset.id) return;
  e.preventDefault();
  const r = li.getBoundingClientRect();
  clearDrop();
  li.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
});
list.addEventListener("drop", (e) => {
  const li = inList(e.target);
  e.preventDefault();
  if (!li) return;
  const targetId = li.dataset.id;
  if (!dragId || dragId === targetId) return;
  const before = li.classList.contains("drop-before");
  const from = tasks.findIndex(x => x.id === dragId);
  if (from < 0) return;   // la tâche a disparu entre-temps (synchro) : splice(-1) aurait supprimé la dernière
  const [moved] = tasks.splice(from, 1);
  let to = tasks.findIndex(x => x.id === targetId);
  if (!before) to++;
  tasks.splice(to, 0, moved);
  persist(); render();
  // Le rendu a remplacé la ligne source : le dragend du navigateur la visera détachée et
  // n'atteindra donc plus #list. On remet l'état de glisser à zéro ici (comme le faisait dragend).
  dragId = null;
});

function completeToggle(task) {
  if (completing.has(task.id)) return;
  if (!task.done && task.repeat && task.repeat !== "none") {
    completing.add(task.id);
    const clone = { ...task, id: newId(), done: false, due: nextDueIso(task), updatedAt: Date.now() };
    delete clone.next;
    if (clone.repeat === "monthly" && task.due) clone.repeatDay = monthlyAnchor(task); else delete clone.repeatDay;
    const at = tasks.indexOf(task);
    if (at < 0) { completing.delete(task.id); return; }   // tâche disparue entre-temps : ne rien créer
    // Mise à jour SYNCHRONE : la prochaine occurrence et le lien « next » sont enregistrés même si
    // le popup se ferme juste après le clic (avant, tout dépendait de la fin de markPast()).
    tasks.splice(at, 0, clone);
    task.next = clone.id; task.repeat = "none"; task.done = true; task.updatedAt = Date.now(); doneId = task.id; enterId = clone.id;
    persist(); render(); playSound("done");
    focusTaskCheck(task.id);
    // Après l'enregistrement : uniquement pour éviter un rappel immédiat si l'occurrence est déjà due.
    markPast(clone).catch(() => {}).finally(() => completing.delete(task.id));
    return;
  }
  if (task.done && task.next) {   // décocher : retire l'occurrence suivante si elle n'a pas été touchée
    const nx = tasks.find(x => x.id === task.next);
    if (nx && !nx.done) {
      task.repeat = nx.repeat;
      // l'occurrence suivante porte l'ancre mensuelle : la restituer, sinon on repartirait du 28
      if (nx.repeat === "monthly" && validDay(nx.repeatDay)) task.repeatDay = Number(nx.repeatDay); else delete task.repeatDay;
      tasks.splice(tasks.indexOf(nx), 1); tombstone("t", nx.id);
    }
    delete task.next;
  }
  task.done = !task.done; task.updatedAt = Date.now(); if (task.done) { doneId = task.id; playSound("done"); }
  persist(); render(); focusTaskCheck(task.id);
}

// Le rendu reconstruit la liste : sans cela, le focus retombait sur le document après chaque clic.
function focusTaskCheck(id) {
  let n = list.querySelector('.task[data-id="' + cssEsc(id) + '"] .check');
  // Tâche devenue invisible (filtre « À faire », recherche, tri) : ne pas laisser le focus au document.
  if (!n) n = list.querySelector(".task .check") || (IS_ANDROID ? $("add-btn") : $("new-text"));
  if (!n) return;
  try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (e2) {} }
}
// Retour du focus sur le bouton « Modifier » après la fermeture d'une feuille ou d'une édition.
function focusTaskEdit(id) {
  const n = list.querySelector('.task[data-id="' + cssEsc(id) + '"] .edit-btn') || (IS_ANDROID ? $("add-btn") : $("new-text"));
  if (!n) return;
  try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (e2) {} }
}
function focusProjectEdit(id) {
  const n = $("project-list").querySelector('.project[data-id="' + cssEsc(id) + '"] .p-edit-btn') || $("new-project");
  if (!n) return;
  try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (e2) {} }
}
// Après l'édition d'une sous-tâche, revenir sur son bouton « Modifier ».
function focusSubButton(pid, sid) {
  const n = $("project-list").querySelector('.project[data-id="' + cssEsc(pid) + '"] .stask[data-sub-id="' + cssEsc(sid) + '"] .mini');
  if (!n) return;
  try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (e2) {} }
}

// `fn` facultatif : les boutons de la liste de tâches sont gérés par délégation (un seul
// écouteur sur #list), ceux des projets et sous-tâches gardent le leur.
function mini(svg, title, fn) {
  const b = el("button", "mini", svg);
  b.type = "button"; b.title = title; b.setAttribute("aria-label", title);
  if (typeof fn === "function") b.addEventListener("click", fn);
  return b;
}

// Fin d'une édition : intègre les changements reçus pendant celle-ci. La tâche éditée l'emporte (elle est plus récente).
function adoptPending(task) {
  if (!pendingTasks) return task;
  const fresh = normTasks(pendingTasks); pendingTasks = null;
  tasks = fresh;
  const cur = fresh.find(x => x.id === task.id);
  if (cur) return cur;
  tasks.unshift(task);   // supprimée ailleurs pendant l'édition : l'édition la ressuscite (updatedAt plus récent que la suppression)
  return task;
}

function editNode(task) {
  const box = el("form", "edit");
  if (IS_ANDROID) { box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", t("edit")); }
  const input = el("input"); input.type = "text"; input.value = task.text; input.maxLength = 200;
  const noteIn = el("textarea"); noteIn.rows = 2; noteIn.maxLength = 500; noteIn.value = task.note || ""; noteIn.placeholder = t("notePlaceholder"); noteIn.className = "note-input";

  const sel = el("select"); buildSelect(sel, PRIOS, ""); sel.value = task.priority;
  const rep = createRepeatPicker(task.repeat);
  const row1 = el("div", "row"); row1.append(sel, rep.root);

  const date = createDatePicker(task.due);
  const time = createTimePicker(task.time);
  const rem = el("select"); buildSelect(rem, REMINDS, "remind_"); rem.value = task.remind || "none";
  const row2 = el("div", "row"); row2.append(date.root, time.root, rem);

  const save = el("button", "primary"); save.type = "submit"; save.textContent = t("save");
  const cancel = el("button"); cancel.type = "button"; cancel.textContent = t("cancel");
  cancel.addEventListener("click", () => { const id = task.id; editingId = null; render(); focusTaskEdit(id); });
  const toProj = el("button", "to-proj", SVG.folder); toProj.type = "button";
  const tpl = el("span"); tpl.textContent = t("toProject"); toProj.appendChild(tpl);
  toProj.addEventListener("click", () => taskToProject(task));
  const row3 = el("div", "row"); row3.append(save, cancel, toProj);

  box.append(input, noteIn, row1, row2, row3);
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    if (date.invalid()) return date.markInvalid();
    if (time.invalid()) return time.markInvalid();
    let due = date.get();
    if (rem.value !== "none" && !due) due = todayIso();
    task = adoptPending(task);   // reprend ce qui est arrivé de la synchro pendant l'édition, en gardant la tâche éditée
    const prevDue = task.due, prevRepeat = task.repeat, repVal = rep.get();
    Object.assign(task, { text: v, note: noteIn.value.trim(), priority: sel.value, repeat: repVal, due, time: time.get(), remind: rem.value, updatedAt: Date.now() });
    if (repVal === "monthly" && due) {
      // on ne recalcule l'ancrage que si l'échéance ou le mode a changé ; sinon on garde le jour d'origine
      if (prevRepeat !== "monthly" || prevDue !== due || !validDay(task.repeatDay)) task.repeatDay = monthlyAnchor({ due });
    } else delete task.repeatDay;   // sans échéance : ancrage sur le jour de complétion (comportement historique)
    await markPast(task);
    editingId = null; persist(); render(); playSound("edit"); focusTaskEdit(task.id);
  });
  box.addEventListener("keydown", (e) => { if (e.key === "Escape") { const id = task.id; editingId = null; render(); focusTaskEdit(id); } });
  setTimeout(() => input.focus(), 0);
  return box;
}

function clearDrop() {
  list.querySelectorAll(".drop-before,.drop-after").forEach(n => n.classList.remove("drop-before", "drop-after"));
}
// Voisin visible dans le même groupe (en retard / autres) : évite les flèches "sans effet".
function neighborIndex(i, d) {
  const late = isLate(tasks[i]);
  for (let j = i + d; j >= 0 && j < tasks.length; j += d) if (isLate(tasks[j]) === late) return j;
  return -1;
}
function move(i, d) {
  const j = neighborIndex(i, d);
  if (j < 0) return;
  [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  persist(); render();
}

/* ---------- formulaire d'ajout ---------- */
const addDue = createDatePicker(null);
$("new-priority").after(addDue.root);
const addRepeat = createRepeatPicker("none");
addDue.root.after(addRepeat.root);

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("new-text").value.trim();
  if (!v) { $("new-text").focus(); return; }
  if (addDue.invalid()) {
    // Le champ date peut être replié par « Détails » : le rouvrir avant de signaler l'erreur,
    // sinon la bordure rouge et le message resteraient invisibles (display:none).
    $("add-form").classList.add("details-open");
    syncAddToggles();
    return addDue.markInvalid();
  }
  const task = {
    id: newId(), text: v, note: ($("new-note").value || "").trim(), priority: $("new-priority").value, repeat: addRepeat.get(),
    due: addDue.get(), time: "09:00", remind: "none", done: false, updatedAt: Date.now()
  };
  if (task.repeat === "monthly" && task.due) task.repeatDay = monthlyAnchor(task);   // conserve le jour choisi (ex. 31)
  await markPast(task);
  tasks.unshift(task); enterId = task.id; playSound("add");
  $("new-text").value = ""; $("new-note").value = ""; addDue.set(null);
  $("new-priority").value = defaultPriority; addRepeat.set("none");
  $("add-form").classList.remove("note-open", "details-open");   // note et détails repliés après l'ajout
  syncAddToggles();
  persist(); render(); $("new-text").focus();
});

/* note et détails repliables sur mobile (masqués par défaut sur desktop) */
function syncAddToggles() {
  const f = $("add-form");
  const openD = f.classList.contains("details-open"), openN = f.classList.contains("note-open");
  $("details-toggle").setAttribute("aria-expanded", String(openD));
  $("note-toggle").setAttribute("aria-expanded", String(openN));
  $("details-toggle").firstElementChild.textContent = openD ? "−" : "+";
  $("note-toggle").firstElementChild.textContent = openN ? "−" : "+";
}
$("details-toggle").addEventListener("click", () => {
  const f = $("add-form");
  f.classList.toggle("details-open");
  syncAddToggles();
});
$("note-toggle").addEventListener("click", () => {
  const f = $("add-form");
  if (f.classList.toggle("note-open")) $("new-note").focus();
  syncAddToggles();
});

/* ---------- recherche ---------- */
$("search").addEventListener("input", (e) => {
  query = e.target.value;
  $("search-clear").hidden = query === "";   // retour visuel immédiat : le champ est natif
  scheduleRender();   // un rendu coalescé par frame au lieu d'une reconstruction par frappe
});
$("search").addEventListener("keydown", (e) => { if (e.key === "Escape" && query) { e.stopPropagation(); clearSearch(); } });
$("search-clear").addEventListener("click", () => { clearSearch(); $("search").focus(); });
function clearSearch() { query = ""; $("search").value = ""; $("search-clear").hidden = true; render(); }

$("clear").addEventListener("click", () => removeTasks(new Set(tasks.filter(x => x.done).map(x => x.id))));

/* ---------- projets (sous-tâches + barre de progression) ---------- */
const PRIO_COLOR = { low: "#34d399", medium: "#7c5cff", high: "#fb7185" };
// Transforme une tâche en projet : date/rappel conservés, chaque ligne de la note devient une sous-tâche.
async function taskToProject(task) {
  const idx = tasks.indexOf(task);
  if (idx < 0) return;
  const lines = (task.note || "").split(/\r?\n/).map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  const p = {
    id: newId(), name: task.text, color: PRIO_COLOR[task.priority] || "#7c5cff", open: true, updatedAt: Date.now(),
    due: task.due || null, time: task.time || "09:00", remind: task.due ? (task.remind || "none") : "none",
    subs: lines.map(text => ({ id: newId(), text: text.slice(0, 200), done: !!task.done }))
  };
  await markPast(p);
  const at = tasks.indexOf(task);
  if (at < 0) return;
  tasks.splice(at, 1); projects.unshift(p);
  tombstone("t", task.id);
  editingId = null; enterProj = p.id; focusSubFor = p.id;
  currentTab = "projects"; api.storage.local.set({ tab: currentTab });
  persist(); persistProjects(); applyView(); render(); playSound("add");
  showToast(t("toProjectDone"), () => {
    projects = projects.filter(x => x.id !== p.id); tombstone("p", p.id); untombstone("t", task.id); task.updatedAt = Date.now(); tasks.splice(Math.min(at, tasks.length), 0, task);
    currentTab = "tasks"; api.storage.local.set({ tab: currentTab });
    persist(); persistProjects(); applyView(); render();
  });
}
const isProjectLate = (p) => !!p.due && !isProjectDone(p) && p.due < todayIso();

const PROJECT_COLORS = ["#7c5cff", "#34d399", "#f59e0b", "#fb7185", "#38bdf8", "#f472b6"];
function projPct(p) { return p.subs.length ? Math.round(p.subs.filter(s => s.done).length / p.subs.length * 100) : 0; }
function isProjectDone(p) { return p.subs.length > 0 && p.subs.every(s => s.done); }

function persistProjects() {
  pendingProjects = null;
  for (const p of projects) { p.name = cleanText(p.name, 80); for (const s of p.subs) s.text = cleanText(s.text, 200); }
  Sync.markDirty();
  api.storage.local.set({ projects });
}
function animateOut(li, fn) {
  if (li && !reduceMotion()) { li.classList.add("leaving"); setTimeout(fn, 190); } else fn();
}

function updateHeader() {
  const label = document.querySelector(".counter span");
  if (currentTab === "projects") {
    const doneP = projects.filter(isProjectDone).length;
    $("left").textContent = projects.length - doneP;
    label.textContent = t("ongoing");
    $("subtitle").textContent = projects.length ? t("projectsSub", { n: projects.length, d: doneP }) : t("projectsEmptyTitle");
  } else {
    const done = tasks.filter(x => x.done).length;
    $("left").textContent = tasks.length - done;
    label.textContent = t("left");
    $("subtitle").textContent = tasks.length ? t("tasksCount", { n: tasks.length, d: done }) : t("emptySub");
  }
}

function renderProjects() {
  if (!editingProject) projectEditCache = null;   // édition terminée : libérer les formulaires
  if (!editingSub) subEditCache = null;
  if (!editingProject && !editingSub && pendingProjects) { projects = normProjects(pendingProjects); pendingProjects = null; }
  const focus = captureFocus();
  const pl = $("project-list");
  $("projects-empty").hidden = projects.length > 0;
  pl.hidden = projects.length === 0;
  pl.replaceChildren(...projects.map(projectNode));
  enterProj = null; enterSub = null; doneSub = null;
  let didFocus = false;
  if (focusSubFor) {
    const inp = pl.querySelector(`[data-sub-input="${cssEsc(focusSubFor)}"]`);
    if (inp) { inp.focus(); didFocus = true; }
    focusSubFor = null;
  }
  if (!didFocus) restoreFocus(focus);
  updateHeader();
  syncSheet();
}

function projectNode(p) {
  const pct = projPct(p), complete = isProjectDone(p);
  const li = el("li", "project" + (complete ? " complete" : "") + (p.open ? " open" : ""));
  li.style.setProperty("--pc", p.color || PROJECT_COLORS[0]);
  li.dataset.id = p.id;
  if (p.id === enterProj) li.classList.add("enter");
  if (editingProject === p.id) {
    if (!projectEditCache || projectEditCache.id !== p.id) projectEditCache = { id: p.id, node: projectEditNode(p) };
    li.appendChild(projectEditCache.node);
    return li;
  }

  const head = el("div", "p-head");
  const tog = el("button", "p-toggle", SVG.chevron);
  tog.type = "button"; tog.title = t(p.open ? "collapse" : "expand"); tog.setAttribute("aria-label", tog.title);
  tog.setAttribute("aria-expanded", String(!!p.open));
  // p.open est un état d'affichage : ne pas toucher updatedAt, sinon replier un projet ferait
  // gagner tout l'objet et écraserait une sous-tâche ajoutée sur un autre appareil.
  const flip = () => { p.open = !p.open; persistProjects(); renderProjects(); };
  tog.addEventListener("click", flip);
  const name = el("button", "p-name"); name.type = "button"; name.textContent = p.name;
  name.addEventListener("click", flip);
  const count = el("span", "p-count"); count.textContent = `${p.subs.filter(s => s.done).length}/${p.subs.length}`;
  const edit = mini(SVG.edit, t("edit"), () => { editingProject = p.id; renderProjects(); });
  edit.classList.add("p-edit-btn");
  const del = el("button", "del", SVG.trash);
  del.type = "button"; del.title = t("del"); del.setAttribute("aria-label", t("del"));
  del.addEventListener("click", () => deleteProject(p, li));
  head.append(tog, name, count, edit, del);

  const barRow = el("div", "p-bar");
  const track = el("div", "bar"); const fill = el("div", "bar-fill");
  fill.style.width = (lastPct[p.id] !== undefined ? lastPct[p.id] : pct) + "%";
  track.appendChild(fill);
  const pctEl = el("span", "p-pct"); pctEl.textContent = complete ? "✓ " + t("projectDone") : pct + "%";
  barRow.append(track, pctEl);
  queueBarFill(fill, pct);   // largeur finale posée dans le lot différé du rendu (une seule paire de rAF)
  lastPct[p.id] = pct;

  li.append(head, barRow);
  if (p.due) {
    const meta = el("div", "p-meta");
    const due = el("span", "due" + (isProjectLate(p) ? " late" : ""));
    due.appendChild(el("span", "ico", SVG.cal));
    if (p.remind && p.remind !== "none") { const b = el("span", "ico", SVG.bell); b.title = t("remind_" + p.remind); due.appendChild(b); }
    const ds = el("span"); ds.textContent = formatDue(p.due) + (p.remind && p.remind !== "none" ? " · " + (p.time || "09:00") : "");
    due.appendChild(ds); meta.appendChild(due); li.appendChild(meta);
  }
  if (p.open) li.appendChild(subsNode(p));
  return li;
}

function subsNode(p) {
  const wrap = el("div", "subs-wrap");
  if (!p.subs.length) {
    const e = el("div", "subs-empty"); e.textContent = t("noSubs"); wrap.appendChild(e);
  } else {
    const ul = el("ul", "subs");
    p.subs.forEach(s => ul.appendChild(subNode(p, s)));
    wrap.appendChild(ul);
  }
  const form = el("form", "sub-add");
  const inp = el("input"); inp.type = "text"; inp.maxLength = 200; inp.placeholder = t("subPlaceholder");
  inp.dataset.subInput = p.id;
  if (subDrafts.has(p.id)) inp.value = subDrafts.get(p.id);   // brouillon conservé entre deux rendus
  inp.addEventListener("input", () => { subDrafts.set(p.id, inp.value); });
  const btn = el("button", "sub-add-btn", "+"); btn.type = "submit"; btn.title = t("add"); btn.setAttribute("aria-label", t("add"));
  form.append(inp, btn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    subDrafts.delete(p.id);
    const s = { id: newId(), text: v, done: false };
    p.subs.push(s); p.updatedAt = Date.now(); enterSub = s.id; focusSubFor = p.id;
    persistProjects(); renderProjects(); playSound("add");
  });
  wrap.appendChild(form);
  return wrap;
}

function subNode(p, s) {
  const li = el("li", "stask" + (s.done ? " done" : ""));
  li.dataset.subId = s.id;
  if (s.id === enterSub) li.classList.add("enter");
  if (s.id === doneSub) li.classList.add("just-done");

  if (editingSub && editingSub.pid === p.id && editingSub.sid === s.id) {
    li.classList.add("editing");
    const key = p.id + "\u0000" + s.id;
    if (!subEditCache || subEditCache.key !== key) {
      const form = el("form", "sub-edit");
      const inp = el("input"); inp.type = "text"; inp.maxLength = 200; inp.value = s.text;
      const ok = el("button", "mini ok", "✓"); ok.type = "submit"; ok.title = t("save"); ok.setAttribute("aria-label", t("save"));
      const no = el("button", "mini", "×"); no.type = "button"; no.title = t("cancel"); no.setAttribute("aria-label", t("cancel"));
      no.addEventListener("click", () => { const pid = p.id, sid = s.id; editingSub = null; renderProjects(); focusSubButton(pid, sid); });
      form.append(inp, ok, no);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const v = inp.value.trim();
        if (!v) return;
        const r = adoptPendingProjects(p, s); p = r.p; s = r.s;
        s.text = v; p.updatedAt = Date.now();
        const pid = p.id, sid = s.id;
        editingSub = null; persistProjects(); renderProjects(); playSound("edit"); focusSubButton(pid, sid);
      });
      form.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          const pid = p.id, sid = s.id;
          editingSub = null; renderProjects(); focusSubButton(pid, sid);
        }
      });
      subEditCache = { key, node: form };
      setTimeout(() => inp.focus(), 0);   // focus à la création ; les rendus suivants le restaurent via renderProjects
    }
    li.appendChild(subEditCache.node);
    return li;
  }

  const check = el("button", "scheck", SVG.check);
  check.type = "button"; check.title = s.done ? t("markUndone") : t("markDone"); check.setAttribute("aria-label", check.title);
  check.addEventListener("click", () => {
    s.done = !s.done;
    p.updatedAt = Date.now();
    if (s.done) { doneSub = s.id; playSound("done"); }
    persistProjects(); renderProjects();
  });
  const text = el("span", "s-text"); text.textContent = s.text;
  const edit = mini(SVG.edit, t("edit"), () => { editingSub = { pid: p.id, sid: s.id }; renderProjects(); });
  const del = el("button", "del", SVG.trash);
  del.type = "button"; del.title = t("del"); del.setAttribute("aria-label", t("del"));
  del.addEventListener("click", () => deleteSub(p, s, li));
  li.append(check, text, edit, del);
  return li;
}

function projectEditNode(p) {
  const box = el("form", "edit p-edit");
  if (IS_ANDROID) { box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", t("edit")); }
  const input = el("input"); input.type = "text"; input.value = p.name; input.maxLength = 80;
  let color = p.color || PROJECT_COLORS[0];
  const sw = el("div", "swatches");
  PROJECT_COLORS.forEach(c => {
    const b = el("button", "swatch"); b.type = "button"; b.style.setProperty("--c", c);
    b.title = t("colorLabel"); b.setAttribute("aria-label", t("colorLabel")); b.setAttribute("aria-pressed", String(c === color));
    b.addEventListener("click", () => { color = c; sw.querySelectorAll(".swatch").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
    sw.appendChild(b);
  });
  const date = createDatePicker(p.due);
  const time = createTimePicker(p.time);
  const rem = el("select"); buildSelect(rem, REMINDS, "remind_"); rem.value = p.remind || "none";
  const wrow = el("div", "row"); wrow.append(date.root, time.root, rem);
  const save = el("button", "primary"); save.type = "submit"; save.textContent = t("save");
  const cancel = el("button"); cancel.type = "button"; cancel.textContent = t("cancel");
  cancel.addEventListener("click", () => { const id = p.id; editingProject = null; renderProjects(); focusProjectEdit(id); });
  const row = el("div", "row"); row.append(save, cancel);
  box.append(input, sw, wrow, row);
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    if (date.invalid()) return date.markInvalid();
    if (time.invalid()) return time.markInvalid();
    let due = date.get();
    if (rem.value !== "none" && !due) due = todayIso();
    p = adoptPendingProjects(p, null).p;
    Object.assign(p, { name: v, color, due, time: time.get(), remind: rem.value, updatedAt: Date.now() });
    await markPast(p);
    editingProject = null; persistProjects(); renderProjects(); playSound("edit"); focusProjectEdit(p.id);
  });
  box.addEventListener("keydown", (e) => { if (e.key === "Escape") { const id = p.id; editingProject = null; renderProjects(); focusProjectEdit(id); } });
  setTimeout(() => input.focus(), 0);
  return box;
}

// Même principe que adoptPending, pour les projets (et leurs sous-tâches).
function adoptPendingProjects(p, s) {
  if (!pendingProjects) return { p, s };
  const fresh = normProjects(pendingProjects); pendingProjects = null;
  projects = fresh;
  const np = fresh.find(x => x.id === p.id);
  if (!np) { projects.unshift(p); return { p, s }; }
  if (!s) return { p: np, s: null };
  const ns = np.subs.find(x => x.id === s.id);
  if (!ns) { np.subs.push(s); return { p: np, s }; }
  return { p: np, s: ns };
}
// Rafraîchissement venu de la synchro : conserve le texte, le curseur et le défilement
// dans le champ « ajouter une sous-tâche » (le rendu reconstruit toute la liste).
function renderProjectsKeepInput() {
  const a = document.activeElement;
  const keep = a && a.dataset && a.dataset.subInput
    ? { id: a.dataset.subInput, v: a.value, s: a.selectionStart, e: a.selectionEnd }
    : null;
  const view = $("projects-view");
  const top = view ? view.scrollTop : 0;
  renderProjects();
  if (keep) {
    const inp = $("project-list").querySelector(`[data-sub-input="${cssEsc(keep.id)}"]`);
    if (inp) {
      inp.value = keep.v;
      try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }   // évite un saut sur Android
      try { if (keep.s != null) inp.setSelectionRange(keep.s, keep.e != null ? keep.e : keep.s); } catch (e) {}
    }
  }
  if (view) view.scrollTop = top;   // la liste peut avoir été reconstruite : on restaure la position
}

function deleteProject(p, li) {
  animateOut(li, () => {
    const idx = projects.indexOf(p);
    if (idx < 0) return;
    projects.splice(idx, 1); delete lastPct[p.id];
    subDrafts.delete(p.id);
    tombstone("p", p.id);
    persistProjects(); renderProjects();
    const next = $("project-list").querySelector(".p-name") || (IS_ANDROID ? $("project-add-btn") : $("new-project"));
    if (next) { try { next.focus({ preventScroll: true }); } catch (e) { try { next.focus(); } catch (e2) {} } }
    showToast(t("projectDeleted"), () => { untombstone("p", p.id); p.updatedAt = Date.now(); projects.splice(Math.min(idx, projects.length), 0, p); persistProjects(); renderProjects(); });
  });
}
function deleteSub(p, s, li) {
  animateOut(li, () => {
    const idx = p.subs.indexOf(s);
    if (idx < 0) return;
    p.subs.splice(idx, 1); p.updatedAt = Date.now();
    focusSubFor = p.id;   // le champ « ajouter une sous-tâche » reprend le focus après le rendu
    persistProjects(); renderProjects();
    showToast(t("subDeleted"), () => {
      if (!projects.includes(p)) return;
      p.subs.splice(Math.min(idx, p.subs.length), 0, s); p.updatedAt = Date.now(); persistProjects(); renderProjects();
    });
  });
}

$("project-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("new-project").value.trim();
  if (!v) { $("new-project").focus(); return; }
  const p = { id: newId(), name: v, color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length], open: true, updatedAt: Date.now(), subs: [] };
  projects.unshift(p); enterProj = p.id; focusSubFor = p.id;
  $("new-project").value = "";
  persistProjects(); renderProjects(); playSound("add");
});

/* ---------- onglets / vues ---------- */
function applyView() {
  $("main-view").hidden = inSettings || currentTab !== "tasks";
  $("projects-view").hidden = inSettings || currentTab !== "projects";
  $("settings-view").hidden = !inSettings;
  $("tabs").hidden = inSettings;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === currentTab)));
  syncSheet();
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.tab === currentTab) return;
  currentTab = b.dataset.tab; api.storage.local.set({ tab: currentTab }); applyView();
  if (currentTab === "projects") { renderProjects(); if (!focusActiveEdit()) $("new-project").focus(); }
  else { render(); if (!focusActiveEdit()) $("new-text").focus(); }
}));

/* ---------- réglages ---------- */
function showSettings(on) {
  try { $("about").textContent = "Zen Todo · v" + api.runtime.getManifest().version; } catch (e) {}
  if (on && IS_ANDROID && !inSettings) { try { history.pushState({ zt: "settings" }, ""); } catch (e) {} }
  inSettings = on; applyView();
  $("msg").textContent = ""; resetWipe();
}
// Sur Android, le bouton retour du système doit revenir aux tâches, pas fermer la popup.
let settingsClosing = false;
function focusActiveEdit() {
  const form = activeEditForm() || (currentTab === "projects" && editingSub ? $("projects-view").querySelector(".sub-edit") : null);
  if (!form) return false;
  const f = form.querySelector("input, textarea, select");
  if (!f) return false;
  try { f.focus(); } catch (e) { try { f.focus(); } catch (e2) {} }
  return true;
}
function focusAfterSettings() {
  if (focusActiveEdit()) return;   // une édition était ouverte avant Options : on y revient
  const g = $("settings");
  if (g) { try { g.focus({ preventScroll: true }); } catch (e) { try { g.focus(); } catch (e2) {} } }
}
function closeSettings() {
  if (!inSettings || settingsClosing) return;
  settingsClosing = true;   // évite un double history.back() sur double-clic
  inSettings = false; applyView();
  focusAfterSettings();
  if (IS_ANDROID && history.state && history.state.zt === "settings") { try { history.back(); } catch (e) {} }
  setTimeout(() => { settingsClosing = false; }, 350);
}
$("settings").addEventListener("click", () => {
  if (settingsClosing) return;
  if (inSettings) closeSettings(); else showSettings(true);
});
$("back").addEventListener("click", closeSettings);
window.addEventListener("popstate", () => {
  if (!inSettings) return;
  inSettings = false; applyView(); focusAfterSettings();
});

// Feuille d'édition Android : la classe sur <body> affiche le fond assombri.
function activeEditForm() {
  const scope = currentTab === "projects" ? $("projects-view") : $("main-view");
  return scope ? scope.querySelector(".edit") : null;
}
function syncSheet() {
  const editing = currentTab === "projects" ? editingProject : editingId;
  // Vérifier que le formulaire est réellement dans la vue : une tâche filtrée ou supprimée
  // pendant l'édition ne doit pas laisser un fond assombri sans feuille.
  const visible = IS_ANDROID && !inSettings && !!editing && !!activeEditForm();
  document.body.classList.toggle("sheet-open", visible);
}
// Toucher en dehors de la feuille annule l'édition (comportement attendu d'une feuille modale).
// Ne fermer que l'édition de l'onglet courant : l'autre onglet peut garder une édition en cours.
document.addEventListener("pointerdown", (e) => {
  if (!IS_ANDROID || !document.body.classList.contains("sheet-open")) return;
  if (e.target && e.target.closest && e.target.closest(".edit")) return;
  if (currentTab === "projects") {
    if (editingProject) { const id = editingProject; editingProject = null; renderProjects(); focusProjectEdit(id); }
  } else if (editingId) {
    const id = editingId; editingId = null; render(); focusTaskEdit(id);
  }
}, true);
// Piège de focus : Tab reste dans la feuille tant qu'elle est ouverte.
document.addEventListener("keydown", (e) => {
  if (!IS_ANDROID || e.key !== "Tab" || !document.body.classList.contains("sheet-open")) return;
  const sheet = activeEditForm();
  if (!sheet) return;
  const f = [...sheet.querySelectorAll("button, input, select, textarea")].filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, true);
document.querySelectorAll(".lang[data-lang]").forEach(b => b.addEventListener("click", () => {
  api.storage.local.set({ lang: b.dataset.lang });
  touchSettings();
  applyLang(b.dataset.lang);
}));
/* priorité par défaut : 3 pastilles colorées */
let prioChipsKey = null;
function renderPrioChips() {
  const box = $("prio-chips");
  const key = LANG + "|" + defaultPriority;
  if (key === prioChipsKey) return;   // même langue et même défaut : DOM identique, rien à refaire
  prioChipsKey = key;
  box.replaceChildren(...PRIOS.map(p => {
    const b = el("button", "chip chip-" + p); b.type = "button"; b.setAttribute("role", "radio");
    b.setAttribute("aria-pressed", String(p === defaultPriority)); b.setAttribute("aria-checked", String(p === defaultPriority));
    b.appendChild(el("i")); const l = el("span"); l.textContent = t(p); b.appendChild(l);
    b.addEventListener("click", () => {
      defaultPriority = p;
      api.storage.local.set({ defaultPriority });
      touchSettings();
      $("new-priority").value = defaultPriority;
      renderPrioChips();
    });
    return b;
  }));
}
let wipeArmed = false;
function resetWipe() { wipeArmed = false; $("wipe").classList.remove("armed"); $("wipe").textContent = t("optDeleteAll"); }
$("wipe").addEventListener("click", () => {
  if (!wipeArmed) { wipeArmed = true; $("wipe").classList.add("armed"); $("wipe").textContent = t("confirmDelete"); return; }
  hideToast();   // une annulation de suppression ne doit pas ressusciter une tâche après l'effacement
  if (tasks.length || projects.length) api.storage.local.set({ backup: { time: Date.now(), tasks, projects } }).then(() => renderSyncUI());   // filet de sécurité AVANT l'effacement
  const now = Date.now();
  tasks.forEach(x => { if (safeId(x.id)) syncDel.t[x.id] = now; });   // tout marquer supprimé : l'effacement se propage
  projects.forEach(p => { if (safeId(p.id)) syncDel.p[p.id] = now; });
  api.storage.local.set({ del: syncDel });
  editingId = null; editingProject = null; editingSub = null;   // un effacement total ferme toute édition
  subDrafts.clear();
  tasks = []; projects = [];   // les projets doivent aussi disparaître (et être supprimés de la synchro)
  persist(); persistProjects(); render(); resetWipe(); $("msg").textContent = t("optDeleted");
});

/* ----- raccourcis clavier (popup + panneau latéral) ----- */
function keyName(e) {
  if (/^[a-zA-Z0-9]$/.test(e.key)) return e.key.toUpperCase();
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);   // Option/AltGr : e.key peut valoir « å », « € »… mais le code reste KeyA…KeyZ
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(c)) return c;
  return ({ Space: "Space", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Comma: "Comma", Period: "Period" })[c] || null;
}
function makeShortcut(cmd, ids) {
  const btn = $(ids.btn), msgEl = $(ids.msg);
  let recording = false;
  const msg = (txt, err) => { msgEl.textContent = txt || ""; msgEl.classList.toggle("err", !!err); };
  // Affiche le raccourci sous forme de touches (Alt + Shift + T)
  function show(sc) {
    if (!sc) { btn.textContent = t("shortcutNone"); return; }
    const nodes = [];
    sc.split("+").forEach((k, i) => {
      if (i) { const p = el("span", "k-sep"); p.textContent = "+"; nodes.push(p); }
      const kb = el("kbd"); kb.textContent = k; nodes.push(kb);
    });
    btn.replaceChildren(...nodes);
  }
  async function load() {
    try { const c = (await api.commands.getAll()).find(x => x.name === cmd); show(c && c.shortcut); }
    catch (e) { show(null); }
  }
  function stop() { recording = false; document.removeEventListener("keydown", onKey, true); btn.classList.remove("rec"); load(); }
  function onKey(e) {
    e.preventDefault(); e.stopPropagation();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    if (e.key === "Escape") { msg(""); return stop(); }
    const k = keyName(e);
    if (!k || e.metaKey || !(e.ctrlKey || e.altKey || /^F\d+$/.test(k))) return msg(t("shortcutInvalid"), true);
    const sc = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", k].filter(Boolean).join("+");
    stop();
    api.commands.update({ name: cmd, shortcut: sc })
      .then(() => { msg(t("shortcutSaved")); load(); })
      .catch(() => { msg(t("shortcutError"), true); load(); });
  }
  btn.addEventListener("click", () => {
    if (!api.commands) return msg(t("shortcutError"), true);   // Android : API absente
    if (recording) return stop();
    recording = true; msg("");
    btn.textContent = t("shortcutPress"); btn.classList.add("rec");
    document.addEventListener("keydown", onKey, true);
  });
  btn.addEventListener("blur", () => { if (recording) stop(); });
  $(ids.reset).addEventListener("click", () => {
    if (!api.commands) return msg(t("shortcutError"), true);   // Android : API absente
    api.commands.reset(cmd).then(() => { msg(t("shortcutSaved")); load(); }).catch(() => msg(t("shortcutError"), true));
  });
  return { load };
}
// MV3 : la commande du popup s'appelle "_execute_action" (MV2 : "_execute_browser_action")
const POPUP_CMD = (() => { try { return api.runtime.getManifest().manifest_version >= 3 ? "_execute_action" : "_execute_browser_action"; } catch (e) { return "_execute_action"; } })();
// nom de la commande du panneau latéral : natif sur Firefox, personnalisé sur Chrome/Opera
const SIDEBAR_CMD = api.sidebarAction ? "_execute_sidebar_action" : "zen-sidebar";
const shortcuts = [
  makeShortcut(POPUP_CMD, { btn: "sc-btn", reset: "sc-reset", msg: "sc-msg" }),
  makeShortcut(SIDEBAR_CMD, { btn: "sb-btn", reset: "sb-reset", msg: "sb-msg" })
];
const loadShortcut = async () => {
  for (const s of shortcuts) await s.load();
  // l'aide affiche le vrai raccourci du panneau latéral, propre à chaque navigateur
  try {
    const c = (await api.commands.getAll()).find(x => x.name === SIDEBAR_CMD);
    $("sb-hint").textContent = t("sidebarHint", { k: (c && c.shortcut) || "—" });
  } catch (e) {}
};

/* ----- panneau latéral ----- */
$("sidebar-toggle").addEventListener("click", async () => {
  try {
    if (isSidebar) {   // nous SOMMES le panneau latéral : le refermer
      if (api.sidebarAction) api.sidebarAction.close();
      else if (api.sidePanel && api.windows) { const w = await api.windows.getLastFocused(); await api.sidePanel.setOptions({ windowId: w.id, enabled: false }); }
      else window.close();
      return;
    }
    if (api.sidebarAction) {   // Firefox
      await api.sidebarAction.open();
      window.close();
    } else if (api.sidePanel) {   // Chrome / Opera
      let windowId = null;
      try { const [tab] = await api.tabs.query({ active: true, currentWindow: true }); windowId = tab && tab.windowId; } catch (e) {}
      if (windowId == null) windowId = (await api.windows.getLastFocused()).id;
      await api.sidePanel.open({ windowId });
      window.close();
    }
  } catch (e) {}
});
function labelSidebarBtn() { $("sidebar-toggle").textContent = t(isSidebar ? "sidebarClose" : "sidebarOpen"); }

$("badge-toggle").addEventListener("change", () => { api.storage.local.set({ badge: $("badge-toggle").checked }); touchSettings(); });
$("sound-toggle").addEventListener("change", () => { api.storage.local.set({ sound: $("sound-toggle").checked }); touchSettings(); });
$("sort-select").addEventListener("change", () => {
  sortBy = $("sort-select").value; api.storage.local.set({ sortBy }); touchSettings();
  $("sort-select-settings").value = sortBy; render();
});
$("sort-select-settings").addEventListener("change", () => {
  sortBy = $("sort-select-settings").value; api.storage.local.set({ sortBy }); touchSettings();
  $("sort-select").value = sortBy; render();
});

/* ---------- compte Google / synchronisation ---------- */
/* la poussée survit à la fermeture du popup : l'arrière-plan la relaie si le popup meurt avant le délai */
const _markDirty = Sync.markDirty.bind(Sync);
Sync.markDirty = () => { _markDirty(); api.runtime.sendMessage({ type: "zt:dirty" }).catch(() => {}); };
function syncMsg(txt, err) { const m = $("sync-msg"); m.textContent = txt || ""; m.classList.toggle("err", !!err); }
function syncKey(code) {
  return code === "ok" ? "syncOk" : code === "network" ? "syncNet" : code === "reauth" ? "syncReauth" : code === "signin" || code === "nosetup" ? "syncSignInErr" : "syncErr";
}
function syncStateText(s) { return t(syncKey(s.code)) + (s.detail ? " — " + s.detail : ""); }
let restoreArmed = false;
function resetRestore() { restoreArmed = false; const b = $("restore-backup"); b.classList.remove("armed"); b.textContent = t("restoreBackup"); }
// Clés du bloc synchro lues en une fois (compte Google compris) : un seul aller-retour au lieu de
// deux appels séquentiels (Sync.account() puis le get des trois valeurs).
const SYNC_READ_KEYS = { gAccount: null, syncState: null, backup: null, lastSync: 0 };
async function renderSyncUI(snapshot) {
  const ok = Sync.available() && Sync.configured();
  $("sync-setup").hidden = ok;
  // `snapshot` : valeurs déjà lues au démarrage, pour ne rien relire sur ce chemin.
  const s = snapshot || await api.storage.local.get(SYNC_READ_KEYS);
  const acct = (ok && s.gAccount && typeof s.gAccount === "object") ? s.gAccount : null;   // comme Sync.account()
  const syncState = s.syncState, backup = s.backup, lastSync = s.lastSync;
  $("sync-signin").hidden = !(ok && !acct);
  $("sync-on").hidden = !(ok && acct);

  /* indicateur compact dans l'en-tête : gris = déconnecté, violet = connecté, rouge = dernière erreur */
  const ind = $("sync-ind");
  if (ind) {
    ind.hidden = !ok;
    if (ok) {
      // Une erreur reste visible jusqu'à la prochaine synchronisation réussie (record("ok")).
      const bad = !!acct && syncState && syncState.code !== "ok";
      ind.classList.toggle("off", !acct);
      ind.classList.toggle("on", !!acct && !bad);
      ind.classList.toggle("err", !!bad);
      ind.title = !acct ? t("syncSignIn") : bad ? t("syncErr") : t("syncNow");
      ind.setAttribute("aria-label", ind.title);
    }
  }
  $("restore-backup").hidden = !(backup && Array.isArray(backup.tasks) && Array.isArray(backup.projects));
  if (!acct) return;
  $("sync-email").textContent = acct.email || t("syncTitle");
  $("sync-last").textContent = lastSync ? t("syncLast", { t: new Date(lastSync).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : "";
  // Dernière erreur : afficher aussi le détail renvoyé par Google (API désactivée, portée refusée…)
  // tant qu'une synchronisation n'a pas réussi.
  if (syncState && syncState.code !== "ok") syncMsg(syncStateText(syncState), true);
}
$("sync-signin").addEventListener("click", () => { syncMsg(t("syncOpening")); api.runtime.sendMessage({ type: "zt:signin" }).catch(() => {}); });
$("sync-out").addEventListener("click", () => { syncMsg(""); api.runtime.sendMessage({ type: "zt:signout" }).catch(() => {}); });
$("sync-now").addEventListener("click", async () => {
  $("sync-now").disabled = true;
  let r = await Sync.syncNow();
  $("sync-now").disabled = false;
  if (r === "reauth") {
    // Jeton expiré et renégociation silencieuse impossible : ouvrir directement la connexion
    // interactive au lieu de demander à l'utilisateur de se déconnecter puis de se reconnecter.
    syncMsg(t("syncOpening"));
    api.runtime.sendMessage({ type: "zt:signin" }).catch(() => {});
  } else {
    syncMsg(t(syncKey(r)), r !== "ok");
  }
  renderSyncUI();
});
/* bouton de synchro de l'en-tête : déconnecté = lancer la connexion, connecté = synchroniser */
$("sync-ind").addEventListener("click", async () => {
  if (!(Sync.available() && Sync.configured())) return;
  const ind = $("sync-ind");
  if (!(await Sync.account())) { api.runtime.sendMessage({ type: "zt:signin" }).catch(() => {}); return; }
  ind.classList.add("busy");
  const r = await Sync.syncNow();
  ind.classList.remove("busy");
  if (r === "reauth") {
    syncMsg(t("syncOpening"));
    api.runtime.sendMessage({ type: "zt:signin" }).catch(() => {});
  }
  renderSyncUI();
});

/* restauration : remet les tâches/projets tels qu'ils étaient juste avant la dernière synchro,
   en les ré-horodatant pour qu'elles reprennent le dessus sur le cloud */
$("restore-backup").addEventListener("click", async () => {
  const btn = $("restore-backup");
  if (!restoreArmed) { restoreArmed = true; btn.classList.add("armed"); btn.textContent = t("confirmDelete"); return; }
  const { backup } = await api.storage.local.get({ backup: null });
  resetRestore();
  hideToast();   // une annulation de suppression ne doit pas s'appliquer au jeu restauré
  if (!backup || !Array.isArray(backup.tasks) || !Array.isArray(backup.projects)) return;
  const now = Date.now();
  tasks = normTasks(backup.tasks).map(x => ({ ...x, updatedAt: now }));
  projects = normProjects(backup.projects).map(p => ({ ...p, updatedAt: now }));
  tasks.forEach(x => { delete syncDel.t[x.id]; });
  projects.forEach(p => { delete syncDel.p[p.id]; });
  api.storage.local.set({ del: syncDel });
  editingId = null; editingProject = null; editingSub = null;   // une restauration ferme toute édition
  subDrafts.clear();
  persist(); persistProjects(); render();
  $("msg").textContent = t("restoreDone");
});

function applyLang(l, opts) {
  if (!isLang(l)) l = defaultLang();   // valeur absente/inconnue : langue du navigateur, jamais l'anglais par accident
  setLang(l); applyStaticI18n(); render(); addDue.refresh(); addRepeat.refresh(); resetWipe(); resetRestore();
  // Au démarrage, les raccourcis (3 appels api.commands.getAll) attendent la première peinture :
  // ils ne sont pas nécessaires à l'affichage de la liste.
  if (!(opts && opts.deferShortcuts)) loadShortcut();
  labelSidebarBtn();
  if (!$("toast").hidden) $("toast-undo").textContent = t("undo");
  document.querySelectorAll(".lang[data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === l)));
}

function applyThemeUI() {
  document.querySelectorAll(".theme").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.theme === THEME)));
}
// Ouverture : theme-init.js a déjà posé data-theme depuis localStorage. setTheme() réécrit
// l'attribut et localStorage (invalidation de style + écriture disque synchrone) juste avant la
// première construction de liste ; on ne l'appelle donc que si la valeur affichée diffère.
function applyThemeOnStartup(th) {
  const want = th === "light" ? "light" : "dark";
  let stored = null;
  try { stored = localStorage.getItem("zt-theme"); } catch (e) {}
  if (stored === want && document.documentElement.getAttribute("data-theme") === want) { THEME = want; return; }   // THEME : global de i18n.js
  setTheme(want);
}
// Taille du texte : réglage local (comme le thème), mémorisé aussi dans localStorage pour éviter un clignotement.
function applyTextSize(v) {
  const size = (v === "small" || v === "large") ? v : "normal";
  let stored = null;
  try { stored = localStorage.getItem("zt-textsize"); } catch (e) {}
  // Même garde que pour le thème : rien à écrire si theme-init.js a déjà posé la bonne valeur.
  if (stored !== size || document.documentElement.getAttribute("data-textsize") !== size) {
    document.documentElement.setAttribute("data-textsize", size);
    try { localStorage.setItem("zt-textsize", size); } catch (e) {}
  }
  document.querySelectorAll(".textsize").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.size === size)));
}

api.storage.local.get({ tasks: [], lang: null, defaultPriority: "medium", badge: true, theme: "dark", sortBy: null, sort: null, sound: true, projects: [], tab: "tasks", filter: "all", del: { t: {}, p: {} }, setTs: 0, textSize: "normal", ...SYNC_READ_KEYS }).then((s) => {
  tasks = normTasks(s.tasks); defaultPriority = PRIOS.includes(s.defaultPriority) ? s.defaultPriority : "medium";
  filter = FILTERS.includes(s.filter) ? s.filter : "all";
  projects = normProjects(s.projects);
  syncDel = readDel(s.del);
  setTs = Number(s.setTs) || 0;
  currentTab = s.tab === "projects" ? "projects" : "tasks"; applyView();
  // « manual » est une valeur volontaire : ne pas retomber sur l'ancienne clé « sort » (héritage)
  sortBy = SORTS.includes(s.sortBy) ? s.sortBy : (SORTS.includes(s.sort) && s.sort !== "manual" ? s.sort : "manual");
  if (s.sort) { api.storage.local.set({ sortBy }); api.storage.local.remove("sort"); }   // migration terminée : la valeur est conservée
  soundOn = s.sound !== false;
  $("badge-toggle").checked = s.badge;
  $("sound-toggle").checked = soundOn;
  applyThemeOnStartup(s.theme || "dark"); applyThemeUI();
  applyLang(s.lang || defaultLang(), { deferShortcuts: true });
  applyTextSize(s.textSize);
  $("new-priority").value = defaultPriority; renderPrioChips();
  // Rien de tout cela n'est nécessaire à la première peinture : bloc synchro, raccourcis puis
  // synchro réseau passent après la frame de rendu (l'ouverture reste fluide même si Google est
  // lent ou si la session doit être renégociée).
  requestAnimationFrame(() => {
    renderSyncUI(s);   // instantané du stockage déjà lu : aucune lecture supplémentaire
    loadShortcut();
    setTimeout(() => Sync.auto(), 0);
  });
  if (currentTab === "projects") $("new-project").focus(); else $("new-text").focus();
});
$("theme-toggle").addEventListener("click", () => { setTheme(THEME === "dark" ? "light" : "dark"); applyThemeUI(); api.storage.local.set({ theme: THEME }); touchSettings(); });
document.querySelectorAll(".theme").forEach(b => b.addEventListener("click", () => { setTheme(b.dataset.theme); applyThemeUI(); api.storage.local.set({ theme: THEME }); touchSettings(); }));
document.querySelectorAll(".textsize").forEach(b => b.addEventListener("click", () => {
  applyTextSize(b.dataset.size);
  api.storage.local.set({ textSize: b.dataset.size });   // préférence locale : ne part pas dans la synchro
}));
/* Regroupe les rendus déclenchés par une rafale de changements de stockage (sync, réglages). */
let pendingRender = false;
function scheduleRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => { pendingRender = false; render(); });
}
/* Regroupe les rafraîchissements du bloc synchro : gAccount/lastSync/syncState arrivent souvent
   dans la même rafale, un seul rendu suffit (comme scheduleRender). */
let pendingSyncUI = false;
function scheduleSyncUI() {
  if (pendingSyncUI) return;
  pendingSyncUI = true;
  requestAnimationFrame(() => { pendingSyncUI = false; renderSyncUI(); });
}
/* Comparaison en UNE passe avec l'état affiché, à la place de JSON.stringify des deux côtés :
   on ne compare que les champs lus par le rendu, donc « égal » = DOM identique. Aucune
   allocation de chaîne, sortie anticipée à la première différence. */
function sameTasks(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!x || !y) return false;
    if (x.id !== y.id || x.text !== y.text || x.done !== y.done || x.due !== y.due
      || x.priority !== y.priority || x.note !== y.note || x.repeat !== y.repeat
      || x.time !== y.time || x.remind !== y.remind || x.repeatDay !== y.repeatDay
      || x.next !== y.next || (x.updatedAt || 0) !== (y.updatedAt || 0)) return false;
  }
  return true;
}
function sameProjects(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!x || !y) return false;
    if (x.id !== y.id || x.name !== y.name || x.color !== y.color || x.due !== y.due
      || x.time !== y.time || x.remind !== y.remind || !!x.open !== !!y.open
      || (x.updatedAt || 0) !== (y.updatedAt || 0)) return false;
    const sx = Array.isArray(x.subs) ? x.subs : [], sy = Array.isArray(y.subs) ? y.subs : [];
    if (sx.length !== sy.length) return false;
    for (let j = 0; j < sx.length; j++) {
      const p = sx[j], q = sy[j];
      if (!p || !q || p.id !== q.id || p.text !== q.text || !!p.done !== !!q.done) return false;
    }
  }
  return true;
}
api.storage.onChanged.addListener((ch) => {
  if (ch.filter) { filter = FILTERS.includes(ch.filter.newValue) ? ch.filter.newValue : "all"; scheduleRender(); }
  if (ch.badge) $("badge-toggle").checked = !!ch.badge.newValue;
  if (ch.del) syncDel = readDel(ch.del.newValue);
  if (ch.gAccount || ch.lastSync) scheduleSyncUI();
  if (ch.syncState) {
    const s = ch.syncState.newValue;
    if (s && typeof s.code === "string" && Date.now() - (Number(s.time) || 0) < 120000) {
      syncMsg(syncStateText(s), s.code !== "ok");
    }
    scheduleSyncUI();
  }
  if (ch.projects && !sameProjects(ch.projects.newValue, projects)) {
    if (editingProject || editingSub) pendingProjects = ch.projects.newValue;   // édition en cours : on attend sa fin
    else { projects = normProjects(ch.projects.newValue); if (currentTab === "projects") renderProjectsKeepInput(); }
  }
  if (ch.tasks && !sameTasks(ch.tasks.newValue, tasks)) {
    if (editingId) pendingTasks = ch.tasks.newValue;   // édition en cours : reconstruire la liste effacerait la saisie
    else { tasks = normTasks(ch.tasks.newValue); scheduleRender(); }
  }
  if (ch.lang) applyLang(isLang(ch.lang.newValue) ? ch.lang.newValue : defaultLang());   // null = langue automatique
  if (ch.theme && ch.theme.newValue) { setTheme(ch.theme.newValue); applyThemeUI(); }
  if (ch.textSize) applyTextSize(ch.textSize.newValue);
  if (ch.defaultPriority && PRIOS.includes(ch.defaultPriority.newValue)) { defaultPriority = ch.defaultPriority.newValue; $("new-priority").value = defaultPriority; renderPrioChips(); }
  if (ch.sortBy && SORTS.includes(ch.sortBy.newValue)) {
    sortBy = ch.sortBy.newValue;
    $("sort-select").value = sortBy; $("sort-select-settings").value = sortBy;
    scheduleRender();
  }
  if (ch.sound) { soundOn = ch.sound.newValue !== false; $("sound-toggle").checked = soundOn; }
});

/* ---------- changement de jour : actualise "en retard", "aujourd'hui" et les dates limites ---------- */
function scheduleMidnight() {
  const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 3);
  setTimeout(midnightTick, next - n);
}
function midnightTick() {
  // édition en cours : on retente le rafraîchissement dans une minute (au lieu de sauter ce changement de jour)
  if (editingId || editingProject || editingSub) { setTimeout(midnightTick, 60000); return; }
  render(); scheduleMidnight();
}
scheduleMidnight();
