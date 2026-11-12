// Requirement 3: unit tests of i18n.js (the real file) with a fake document
// that refuses innerHTML writes. Interpolation must stay textual: markup in a
// variable is data, never HTML.
import assert from "node:assert/strict";
import { VARIANTS } from "../lib/paths.mjs";
import { createSandbox, loadScripts, makeFakeDocument } from "../fake-chrome.mjs";

function boot(variant, options = {}) {
  const sandbox = createSandbox(options);
  loadScripts(sandbox, [`${variant.dir}/i18n.js`]);
  return sandbox;
}

export function register(suite) {
  for (const variant of VARIANTS) {
    const tag = `[${variant.id}]`;

    suite.test(`i18n${tag}: t interpolates every placeholder`, () => {
      const s = boot(variant);
      assert.equal(s.run('t("tasksCount", {n: 3, d: 1})'), "3 tâche(s) · 1 terminée(s)");
      assert.equal(s.run('t("tasksCount", {n: 0, d: 0})'), "0 tâche(s) · 0 terminée(s)");
      assert.equal(s.run('t("menuAdded", {t: "Lire"})'), "Ajouté : Lire");
      assert.equal(s.run('t("sidebarHint", {k: "Alt+Shift+Z"})'), "Raccourci : Alt+Shift+Z. Ouvre le panneau latéral depuis n\'importe quelle page.");
    });

    suite.test(`i18n${tag}: t inserts "$" sequences literally`, () => {
      const s = boot(variant);
      assert.equal(s.run('t("menuAdded", {t: "$& $1 $$ $`"})'), "Ajouté : $& $1 $$ $`");
    });

    suite.test(`i18n${tag}: t keeps user-supplied markup as literal text`, () => {
      const s = boot(variant);
      const payload = '<img src=x onerror="alert(1)">';
      assert.equal(s.run(`t("menuAdded", {t: ${JSON.stringify(payload)}})`), `Ajouté : ${payload}`);
    });

    suite.test(`i18n${tag}: t falls back to English when a key is missing`, () => {
      const s = boot(variant);
      assert.equal(s.run('delete STRINGS.fr.emptySub; t("emptySub")'), "Nothing to do, let's enjoy it.");
      assert.equal(s.run('delete STRINGS.fr.left; t("left")'), "Left");
    });

    suite.test(`i18n${tag}: t returns the key for an unknown string`, () => {
      const s = boot(variant);
      assert.equal(s.run('t("no_such_key")'), "no_such_key");
      assert.equal(s.run('t("no_such_key", {x: 1})'), "no_such_key");
    });

    suite.test(`i18n${tag}: setLang only accepts real languages`, () => {
      const { document } = makeFakeDocument();
      const s = boot(variant, { document });
      assert.equal(s.run('setLang("es"); t("today")'), "Hoy");
      assert.equal(s.run('setLang("de"); t("today")'), "Heute");
      assert.equal(s.run('setLang("__proto__"); t("today")'), "Today");
      assert.equal(s.run('setLang("constructor"); t("today")'), "Today");
      assert.equal(s.run('setLang("xx"); t("today")'), "Today");
      assert.equal(s.run('setLang("fr"); document.documentElement.lang'), "fr");
    });

    suite.test(`i18n${tag}: locale/defaultLang map language codes`, () => {
      const s = boot(variant, { language: "fr-CA" });
      assert.equal(s.run("defaultLang()"), "fr");
      assert.equal(boot(variant, { language: "es-MX" }).run("defaultLang()"), "es");
      assert.equal(boot(variant, { language: "de-AT" }).run("defaultLang()"), "de");
      assert.equal(boot(variant, { language: "ja-JP" }).run("defaultLang()"), "en");
      assert.equal(boot(variant, { language: "en-GB" }).run("defaultLang()"), "en");

      assert.equal(s.run('setLang("fr"); locale()'), "fr-FR");
      assert.equal(s.run('setLang("en"); locale()'), "en-US");
      assert.equal(s.run('setLang("es"); locale()'), "es-ES");
      assert.equal(s.run('setLang("de"); locale()'), "de-DE");
    });

    suite.test(`i18n${tag}: applyStaticI18n writes textContent, never innerHTML`, () => {
      const { document, elements } = makeFakeDocument({
        "[data-i18n]": [{ i18n: "left" }, { i18n: "menuAdded" }],
        "[data-i18n-placeholder]": [{ i18nPlaceholder: "newTask" }],
        "[data-i18n-title]": [{ i18nTitle: "themeTitle" }],
      });
      const s = boot(variant, { document });

      // A translation containing markup must stay literal text in the DOM.
      s.run('STRINGS.fr.menuAdded = "<b>owned</b>"; applyStaticI18n()');

      const [left, menuAdded] = elements["[data-i18n]"];
      assert.equal(left.textContent, "Restantes");
      assert.equal(menuAdded.textContent, "<b>owned</b>");
      assert.equal(elements["[data-i18n-placeholder]"][0].placeholder, "Nouvelle tâche...");
      const title = elements["[data-i18n-title]"][0];
      assert.equal(title.title, "Thème");
      assert.equal(title.attributes["aria-label"], "Thème");
    });
  }
}
