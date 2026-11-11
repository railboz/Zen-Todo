// Heure de déclenchement du rappel (timestamp ms) ou null.
function fireTime(task) {
  if (!task.due || !task.remind || task.remind === "none") return null;
  if (!validIso(task.due) || (task.time && !TIME_RE.test(task.time))) return null;
  const [y, m, d] = task.due.split("-").map(Number);
  const [hh, mm] = (task.time || "09:00").split(":").map(Number);
  const ms = new Date(y, m - 1, d, hh || 0, mm || 0).getTime() - Number(task.remind) * 60000;
  return Number.isFinite(ms) ? ms : null;   // une donnée corrompue ne doit jamais produire d'alarme invalide
}

function localTodayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/* ---------- sécurité : validation stricte de toutes les données lues dans le stockage ---------- */
const PRIOS_ALLOWED = ["low", "medium", "high"];
const REPEATS_ALLOWED = ["none", "daily", "weekly", "monthly"];
const REMINDS_ALLOWED = ["none", "0", "10", "60", "1440"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
// Identifiants réservés du prototype : un id « __proto__ » ou « toString » casserait les
// dictionnaires d'objets (tombstones, notifications, pourcentages de projets).
const RESERVED_IDS = new Set(Object.getOwnPropertyNames(Object.prototype));

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Retire les caractères de contrôle et ceux qui inversent le sens de lecture (usurpation d'affichage), borne la longueur.
function cleanText(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\ufeff]/g, "").slice(0, max);
}
function validIso(s) {
  if (typeof s !== "string" || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number), dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const safeId = (x) => (typeof x === "string" && ID_RE.test(x) && !RESERVED_IDS.has(x)) ? x : null;

// Identifiant de secours STABLE : un id régénéré à chaque lecture créerait des doublons
// et de fausses différences de synchronisation sur des données corrompues.
function stableId(prefix, seed) {
  let h = 0x811c9dc5;
  const s = String(seed == null ? "" : seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return prefix + h.toString(36);
}

// Plusieurs entrées peuvent arriver avec le MÊME identifiant (données anciennes sans id,
// identifiants de secours identiques, stockage corrompu). Les fusionner par identifiant
// perdrait des tâches distinctes. On donne à chaque entrée du groupe un identifiant stable
// dérivé de son contenu complet ; l'ordre de la liste ne change pas le résultat.
function uniqueIds(list, prefix) {
  const counts = new Map();
  for (const item of list) counts.set(item.id, (counts.get(item.id) || 0) + 1);
  const used = new Set(list.map(x => x.id));   // aucun nouvel id ne doit réutiliser un id existant
  const out = [];
  for (const item of list) {
    let id = item.id;
    if (counts.get(id) > 1) {
      const json = JSON.stringify(item);
      let salt = 0, nid;
      do { nid = stableId(prefix, ["dup", id, json, salt].join("\u0000")); salt++; } while (used.has(nid));
      used.add(nid);
      id = nid;
    }
    out.push(id === item.id ? item : { ...item, id });
  }
  return out;
}

// Liste brute (stockage local ou document distant) -> éléments validés, identifiants uniques.
// `cap` absent : aucune troncature (l'arrière-plan relit une liste déjà bornée par l'interface).
function parseList(raw, sanitize, prefix, cap) {
  const list = Array.isArray(raw) ? raw : [];
  return uniqueIds((cap ? list.slice(0, cap) : list).map(sanitize).filter(Boolean), prefix);
}

// Ne garde que les champs connus, avec le bon type : un stockage modifié ou corrompu ne peut rien injecter.
function sanitizeTask(x) {
  if (!x || typeof x !== "object" || typeof x.text !== "string") return null;
  const text = cleanText(x.text, 200).trim();
  if (!text) return null;
  const priority = PRIOS_ALLOWED.includes(x.priority) ? x.priority : "medium";
  const repeat = REPEATS_ALLOWED.includes(x.repeat) ? x.repeat : "none";
  const due = validIso(x.due) ? x.due : null;
  const time = typeof x.time === "string" && TIME_RE.test(x.time) ? x.time : "09:00";
  const remind = REMINDS_ALLOWED.includes(String(x.remind)) ? String(x.remind) : "none";
  const done = x.done === true;
  const note = cleanText(x.note, 500);
  const next = safeId(x.next);
  const rdn = Number(x.repeatDay);
  const repeatDay = repeat === "monthly" && Number.isInteger(rdn) && rdn >= 1 && rdn <= 31 ? rdn : null;
  // Identifiant de secours : la base historique (texte, note, date, heure, horodatage) reste
  // inchangée ; on n'ajoute les champs distinctifs que s'ils diffèrent de leur valeur par défaut,
  // pour ne pas modifier les identifiants déjà générés par les versions précédentes.
  const base = [text, x.note, x.due, x.time, x.updatedAt].join("\u0000");
  const extra = [];
  if (priority !== "medium") extra.push("priority=" + priority);
  if (repeat !== "none") extra.push("repeat=" + repeat);
  if (remind !== "none") extra.push("remind=" + remind);
  if (done) extra.push("done=1");
  if (next) extra.push("next=" + next);
  if (repeatDay) extra.push("repeatDay=" + repeatDay);
  const fallback = stableId("x", extra.length ? base + "\u0000" + extra.join("\u0000") : base);
  const out = {
    id: safeId(x.id) || fallback, text, priority, repeat, due, time, remind, done, note
  };
  if (next) out.next = next;
  if (Number.isFinite(x.updatedAt) && x.updatedAt > 0) out.updatedAt = Math.floor(x.updatedAt);   // horodatage de synchronisation
  if (repeatDay) out.repeatDay = repeatDay;   // jour d'ancrage (31 janv. → 28 févr. → 31 mars)
  return out;
}
function sanitizeProject(p) {
  if (!p || typeof p !== "object" || typeof p.name !== "string") return null;
  const name = cleanText(p.name, 80).trim();
  if (!name) return null;
  const subs = uniqueIds((Array.isArray(p.subs) ? p.subs : []).slice(0, 500).map((s, i) =>
    (s && typeof s === "object" && typeof s.text === "string")
      ? { id: safeId(s.id) || stableId("s", [i, s.text, s.done].join("\u0000")), text: cleanText(s.text, 200).trim(), done: s.done === true } : null).filter(s => s && s.text), "s");
  const color = typeof p.color === "string" && COLOR_RE.test(p.color) ? p.color : "#7c5cff";
  const open = p.open === true;
  const due = validIso(p.due) ? p.due : null;
  const time = typeof p.time === "string" && TIME_RE.test(p.time) ? p.time : "09:00";
  const remind = REMINDS_ALLOWED.includes(String(p.remind)) ? String(p.remind) : "none";
  // Même principe que pour les tâches : base historique inchangée, champs distinctifs en plus.
  const base = [name, p.color, p.due, p.time, p.updatedAt].join("\u0000");
  const extra = [];
  if (open) extra.push("open=1");
  if (remind !== "none") extra.push("remind=" + remind);
  if (subs.length) extra.push("subs=" + subs.map(s => s.id + ":" + s.text + ":" + (s.done ? 1 : 0)).join("\u0001"));
  const fallback = stableId("p", extra.length ? base + "\u0000" + extra.join("\u0000") : base);
  const out = {
    id: safeId(p.id) || fallback, name, color, open, due, time, remind, subs
  };
  if (Number.isFinite(p.updatedAt) && p.updatedAt > 0) out.updatedAt = Math.floor(p.updatedAt);   // horodatage de synchronisation
  return out;
}
