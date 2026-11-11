// Applique le thème mémorisé avant le premier affichage (évite le clignotement).
(function () {
  const root = document.documentElement;
  // Si localStorage est inaccessible (navigation privée), l'attribut n'est pas posé : le défaut CSS s'applique, comme avant.
  try {
    const th = localStorage.getItem("zt-theme") === "light" ? "light" : "dark";
    if (root.getAttribute("data-theme") !== th) root.setAttribute("data-theme", th);
  } catch (e) {}
  // Taille du texte : appliquée avant le premier rendu pour éviter un saut de mise en page.
  try {
    const ts = localStorage.getItem("zt-textsize");
    const size = (ts === "small" || ts === "large") ? ts : "normal";
    if (root.getAttribute("data-textsize") !== size) root.setAttribute("data-textsize", size);
  } catch (e) {}
  // Android : le popup s'ouvre en superposition plein écran (Firefox Android n'a ni sidebar ni raccourcis clavier).
  try { if (/Android/i.test(navigator.userAgent) && !root.classList.contains("android")) root.classList.add("android"); } catch (e) {}
  try {
    if (location.search.indexOf("view=sidebar") !== -1) {   // panneau latéral Chrome/Opera : l'URL suffit, aucun appel d'API
      if (!root.classList.contains("is-sidebar")) root.classList.add("is-sidebar");
    } else {
      // Firefox : le panneau latéral charge popup.html sans paramètre. getViews() énumère toutes les vues de
      // l'extension (coûteux) : appel en dernier recours, ignoré si l'API manque ou échoue.
      const a = typeof browser !== "undefined" ? browser : chrome;
      if (typeof a.extension.getViews === "function" && a.extension.getViews({ type: "sidebar" }).includes(window) && !root.classList.contains("is-sidebar")) root.classList.add("is-sidebar");
    }
  } catch (e) {}
})();
