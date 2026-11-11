// Sélecteur de date intégré (le calendrier natif de Firefox s'ouvre derrière le popup).
const DP_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const pad2 = (n) => String(n).padStart(2, "0");
// Création d'élément SANS innerHTML : le texte passe par textContent, les icônes SVG (constantes du code) sont analysées puis clonées.
const svgCache = new Map();
function svgNode(markup) {
  let n = svgCache.get(markup);
  if (!n) {
    const src = markup.includes("xmlns=") ? markup : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    n = document.importNode(new DOMParser().parseFromString(src, "image/svg+xml").documentElement, true);
    svgCache.set(markup, n);
  }
  return n.cloneNode(true);
}
function mk(tag, cls, content) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content != null && content !== "") {
    if (typeof content === "string" && content.startsWith("<svg")) e.appendChild(svgNode(content));
    else e.textContent = content;
  }
  return e;
}
function toIso(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

/* ---------- registre partagé des pickers ---------- */
// Avant : chaque picker ajoutait 2 écouteurs à `document` (6 au total), retirés seulement si un
// événement ultérieur constatait que son nœud avait quitté le DOM. Désormais un seul jeu
// d'écouteurs pour tous les pickers ; les entrées déconnectées sont balayées à chaque événement.
const DP_PICKERS = new Set();
let dpBound = false;

function dpSweep() {
  for (const p of DP_PICKERS) if (!p.root.isConnected) DP_PICKERS.delete(p);
}
function trackPicker(root, isOpen, close) {
  const entry = { root, isOpen, close };
  DP_PICKERS.add(entry);
  if (!dpBound) {
    dpBound = true;
    document.addEventListener("mousedown", (e) => {
      dpSweep();
      for (const p of DP_PICKERS) if (p.isOpen() && !p.root.contains(e.target)) p.close();   // fermer au clic ailleurs
    });
    document.addEventListener("dp-open", (e) => {
      dpSweep();
      for (const p of DP_PICKERS) if (p.isOpen() && e.detail !== p.root) p.close();   // un seul picker ouvert
    });
  }
  return () => DP_PICKERS.delete(entry);   // retrait explicite possible
}

function formatDateField(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const sp = dateSep();
  return dateOrder() === "dmy" ? `${d}${sp}${m}${sp}${y}` : `${m}${sp}${d}${sp}${y}`;
}
function parseDateField(str) {
  const g = str.replace(/\D/g, "");
  if (g.length !== 8) return null;
  const a = +g.slice(0, 2), b = +g.slice(2, 4), y = +g.slice(4, 8);
  const d = dateOrder() === "dmy" ? a : b, m = dateOrder() === "dmy" ? b : a;
  const dt = new Date(y, m - 1, d);
  if (y < 1900 || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toIso(y, m - 1, d);
}

function createDatePicker(initialIso) {
  let value = initialIso || null;
  let vy, vm, open = false;

  const root = mk("div", "dp");
  const field = mk("div", "dp-field");
  const input = mk("input"); input.type = "text"; input.inputMode = "numeric"; input.maxLength = 10; input.autocomplete = "off";
  const btn = mk("button", "dp-btn", DP_ICON); btn.type = "button";
  const err = mk("span", "dp-err"); err.hidden = true; err.setAttribute("role", "alert");
  field.append(input, btn, err);
  const clearErr = () => { err.hidden = true; };
  const setErr = (msg) => { err.textContent = msg; err.hidden = false; };
  const pop = mk("div", "dp-pop"); pop.hidden = true;
  root.append(field, pop);

  function refresh() {
    input.value = formatDateField(value);
    input.placeholder = t("datePlaceholder");
    input.setAttribute("aria-label", t("datePlaceholder"));
    btn.title = t("openCalendar"); btn.setAttribute("aria-label", btn.title);
    field.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    clearErr();
    if (open) draw();
  }
  function setOpen(v) { open = v; pop.hidden = !v; if (v) { document.dispatchEvent(new CustomEvent("dp-open", { detail: root })); const b = value ? value.split("-") : null; const n = new Date();
    vy = b ? +b[0] : n.getFullYear(); vm = b ? +b[1] - 1 : n.getMonth(); draw(); } }
  function pick(iso) { value = iso; input.value = formatDateField(iso); field.classList.remove("invalid"); input.removeAttribute("aria-invalid"); clearErr(); setOpen(false); }

  function draw() {
    pop.replaceChildren();
    const head = mk("div", "dp-head");
    const prev = mk("button", "dp-nav", "‹"); prev.type = "button"; prev.title = t("prevMonth");
    const next = mk("button", "dp-nav", "›"); next.type = "button"; next.title = t("nextMonth");
    const title = mk("span", "dp-title");
    title.textContent = new Date(vy, vm, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });
    prev.onclick = () => { vm--; if (vm < 0) { vm = 11; vy--; } draw(); };
    next.onclick = () => { vm++; if (vm > 11) { vm = 0; vy++; } draw(); };
    head.append(prev, title, next);

    const grid = mk("div", "dp-grid");
    const ws = LANG === "en" ? 0 : 1;
    for (let i = 0; i < 7; i++) {
      const w = mk("span", "dp-wd");
      w.textContent = new Date(2024, 0, 7 + ((ws + i) % 7)).toLocaleDateString(locale(), { weekday: "narrow" });
      grid.appendChild(w);
    }
    const offset = (new Date(vy, vm, 1).getDay() - ws + 7) % 7;
    for (let i = 0; i < offset; i++) grid.appendChild(mk("span"));
    const n = new Date(), todayIso = toIso(n.getFullYear(), n.getMonth(), n.getDate());
    for (let d = 1; d <= new Date(vy, vm + 1, 0).getDate(); d++) {
      const iso = toIso(vy, vm, d);
      const b = mk("button", "dp-day" + (iso === value ? " sel" : "") + (iso === todayIso ? " today" : ""));
      b.type = "button"; b.textContent = d; b.onclick = () => pick(iso);
      grid.appendChild(b);
    }
    const foot = mk("div", "dp-foot");
    const bt = mk("button", "dp-link"); bt.type = "button"; bt.textContent = t("today"); bt.onclick = () => pick(todayIso);
    const bc = mk("button", "dp-link"); bc.type = "button"; bc.textContent = t("clearDate"); bc.onclick = () => pick(null);
    foot.append(bc, bt);
    pop.append(head, grid, foot);
  }

  input.addEventListener("input", () => {
    const g = input.value.replace(/\D/g, "").slice(0, 8);
    const sp = dateSep();
    input.value = g.slice(0, 2) + (g.length > 2 ? sp + g.slice(2, 4) : "") + (g.length > 4 ? sp + g.slice(4) : "");
    value = parseDateField(input.value);
    field.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    clearErr();
    if (open && value) { const b = value.split("-"); vy = +b[0]; vm = +b[1] - 1; draw(); }
  });
  input.addEventListener("blur", () => { if (input.value && value === null) { field.classList.add("invalid"); input.setAttribute("aria-invalid", "true"); setErr(t("invalidDate")); } });
  btn.addEventListener("click", () => setOpen(!open));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } });
  trackPicker(root, () => open, () => setOpen(false));

  refresh();
  return {
    root, refresh,
    get: () => value,
    invalid: () => input.value.trim() !== "" && value === null,
    markInvalid: () => { field.classList.add("invalid"); input.setAttribute("aria-invalid", "true"); setErr(t("invalidDate")); input.focus(); },
    set: (iso) => { value = iso || null; refresh(); }
  };
}


// Sélecteur d'heure intégré (24 h) : le sélecteur natif s'ouvrirait sous le popup.
const TP_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

function parseTimeField(str) {
  const g = str.replace(/\D/g, "");
  if (g.length !== 4) return null;
  const h = +g.slice(0, 2), m = +g.slice(2, 4);
  return h < 24 && m < 60 ? `${pad2(h)}:${pad2(m)}` : null;
}

function createTimePicker(initial) {
  let value = initial || "09:00";
  let open = false;
  const root = mk("div", "dp");
  const field = mk("div", "dp-field tp");
  const input = mk("input"); input.type = "text"; input.inputMode = "numeric"; input.maxLength = 5; input.autocomplete = "off";
  const btn = mk("button", "dp-btn", TP_ICON); btn.type = "button";
  const err = mk("span", "dp-err"); err.hidden = true; err.setAttribute("role", "alert");
  field.append(input, btn, err);
  const clearErr = () => { err.hidden = true; };
  const setErr = (msg) => { err.textContent = msg; err.hidden = false; };
  const pop = mk("div", "dp-pop"); pop.hidden = true;
  root.append(field, pop);

  function refresh() {
    input.value = value || "";
    input.placeholder = "hh:mm";
    input.setAttribute("aria-label", t("timeLabel"));
    btn.title = t("timeLabel"); btn.setAttribute("aria-label", btn.title);
    field.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    clearErr();
    if (open) draw();
  }
  function setOpen(v) { open = v; pop.hidden = !v; if (v) { document.dispatchEvent(new CustomEvent("dp-open", { detail: root })); draw(); } }
  function setValue(h, m) { value = `${pad2(h)}:${pad2(m)}`; input.value = value; field.classList.remove("invalid"); input.removeAttribute("aria-invalid"); clearErr(); }

  function draw() {
    pop.replaceChildren();
    const [ch, cm] = (value || "09:00").split(":").map(Number);
    const hl = mk("div", "tp-title"); hl.textContent = t("hourLabel");
    const hg = mk("div", "tp-grid");
    for (let h = 0; h < 24; h++) {
      const b = mk("button", "dp-day" + (value && h === ch ? " sel" : "")); b.type = "button"; b.textContent = pad2(h);
      b.onclick = () => { setValue(h, value ? cm : 0); draw(); };
      hg.appendChild(b);
    }
    const ml = mk("div", "tp-title"); ml.textContent = t("minuteLabel");
    const mg = mk("div", "tp-grid");
    for (let m = 0; m < 60; m += 5) {
      const b = mk("button", "dp-day" + (value && m === cm ? " sel" : "")); b.type = "button"; b.textContent = pad2(m);
      b.onclick = () => { setValue(value ? ch : 9, m); setOpen(false); };
      mg.appendChild(b);
    }
    pop.append(hl, hg, ml, mg);
  }

  input.addEventListener("input", () => {
    const g = input.value.replace(/\D/g, "").slice(0, 4);
    input.value = g.slice(0, 2) + (g.length > 2 ? ":" + g.slice(2) : "");
    value = parseTimeField(input.value);
    field.classList.remove("invalid");
    input.removeAttribute("aria-invalid");
    clearErr();
    if (open) draw();
  });
  input.addEventListener("blur", () => { if (!input.value.trim() || value === null) { field.classList.add("invalid"); input.setAttribute("aria-invalid", "true"); setErr(t("invalidTime")); } });
  btn.addEventListener("click", () => setOpen(!open));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } });
  trackPicker(root, () => open, () => setOpen(false));

  refresh();
  return {
    root, refresh,
    get: () => value || "09:00",
    invalid: () => input.value.trim() === "" || value === null,   // champ vide = invalide (plus de 09:00 silencieux)
    markInvalid: () => { field.classList.add("invalid"); input.setAttribute("aria-invalid", "true"); setErr(t("invalidTime")); input.focus(); }
  };
}


// Bouton de répétition (icône infini) + petit menu intégré.
const RP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8"/></svg>';
const RP_VALUES = ["none", "daily", "weekly", "monthly"];

function createRepeatPicker(initial) {
  let value = RP_VALUES.includes(initial) ? initial : "none";
  let open = false;
  const root = mk("div", "dp");
  const btn = mk("button", "rp-btn", RP_ICON); btn.type = "button";
  const pop = mk("div", "dp-pop rp-pop"); pop.hidden = true;
  root.append(btn, pop);

  function refresh() {
    const on = value !== "none";
    const label = t("repeatLabel") + (on ? " : " + t("repeat_" + value) : "");
    btn.dataset.tip = label; btn.setAttribute("aria-label", label);
    btn.classList.toggle("on", on);
    if (open) draw();
  }
  function setOpen(v) { open = v; pop.hidden = !v; if (v) { document.dispatchEvent(new CustomEvent("dp-open", { detail: root })); draw(); } }
  function draw() {
    pop.replaceChildren();
    RP_VALUES.forEach(v => {
      const b = mk("button", "rp-opt" + (v === value ? " sel" : "")); b.type = "button";
      const l = mk("span"); l.textContent = t("repeat_" + v);
      b.appendChild(l);
      if (v === value) b.appendChild(mk("span", "", "✓"));
      b.onclick = () => { value = v; setOpen(false); refresh(); };
      pop.appendChild(b);
    });
  }
  btn.addEventListener("click", () => setOpen(!open));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } });
  trackPicker(root, () => open, () => setOpen(false));

  refresh();
  return { root, refresh, get: () => value, set: (v) => { value = RP_VALUES.includes(v) ? v : "none"; refresh(); } };
}
