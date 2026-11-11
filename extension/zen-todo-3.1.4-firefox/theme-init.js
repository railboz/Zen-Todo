// Applique le thème mémorisé avant le premier affichage (évite le clignotement).
try { document.documentElement.setAttribute("data-theme", localStorage.getItem("zt-theme") === "light" ? "light" : "dark"); } catch (e) {}
// Taille du texte : appliquée avant le premier rendu pour éviter un saut de mise en page.
try {
  const ts = localStorage.getItem("zt-textsize");
  document.documentElement.setAttribute("data-textsize", (ts === "small" || ts === "large") ? ts : "normal");
} catch (e) {}
// Android : le popup s'ouvre en superposition plein écran (Firefox Android n'a ni sidebar ni raccourcis clavier).
try { if (/Android/i.test(navigator.userAgent)) document.documentElement.classList.add("android"); } catch (e) {}
try {
  if (location.search.indexOf("view=sidebar") !== -1) document.documentElement.classList.add("is-sidebar");   // panneau latéral Chrome/Opera
  else {
    const a = typeof browser !== "undefined" ? browser : chrome;
    if (a.extension.getViews({ type: "sidebar" }).includes(window)) document.documentElement.classList.add("is-sidebar");   // Firefox
  }
} catch (e) {}
