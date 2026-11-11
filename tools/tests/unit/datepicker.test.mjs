// Requirement 3: unit tests of the pure date/time helpers exposed by
// datepicker.js. DOM pickers are not executed (no browser in this harness);
// only the parsing/formatting logic that can be tested deterministically.
import assert from "node:assert/strict";
import { VARIANTS } from "../lib/paths.mjs";
import { createSandbox, loadScripts } from "../fake-chrome.mjs";

function boot(variant, language = "fr-FR") {
  const sandbox = createSandbox({ language });
  loadScripts(sandbox, [`${variant.dir}/i18n.js`, `${variant.dir}/datepicker.js`]);
  return sandbox;
}

export function register(suite) {
  for (const variant of VARIANTS) {
    const tag = `[${variant.id}]`;

    suite.test(`datepicker${tag}: parseDateField parses day-first and rejects impossible dates`, () => {
      const s = boot(variant);
      assert.equal(s.run('parseDateField("31/01/2024")'), "2024-01-31");
      assert.equal(s.run('parseDateField("29/02/2024")'), "2024-02-29");
      assert.equal(s.run('parseDateField("01012024")'), "2024-01-01");
      assert.equal(s.run('parseDateField("31.01.2024")'), "2024-01-31");
      assert.equal(s.run('parseDateField("29/02/2023")'), null);
      assert.equal(s.run('parseDateField("31/04/2024")'), null);
      assert.equal(s.run('parseDateField("1/1/2024")'), null);
      assert.equal(s.run('parseDateField("31/01/1899")'), null);
      assert.equal(s.run('parseDateField("nope")'), null);
    });

    suite.test(`datepicker${tag}: parseDateField follows the active locale order`, () => {
      const s = boot(variant);
      s.run('setLang("en")');
      assert.equal(s.run('parseDateField("01/31/2024")'), "2024-01-31");
      assert.equal(s.run('parseDateField("02/29/2024")'), "2024-02-29");
      assert.equal(s.run('parseDateField("31/01/2024")'), null);
    });

    suite.test(`datepicker${tag}: formatDateField formats per locale`, () => {
      const s = boot(variant);
      assert.equal(s.run('formatDateField("2024-01-31")'), "31/01/2024");
      assert.equal(s.run('formatDateField("")'), "");
      s.run('setLang("de")');
      assert.equal(s.run('formatDateField("2024-01-31")'), "31.01.2024");
      s.run('setLang("en")');
      assert.equal(s.run('formatDateField("2024-01-31")'), "01/31/2024");
    });

    suite.test(`datepicker${tag}: parseTimeField validates 24h times`, () => {
      const s = boot(variant);
      assert.equal(s.run('parseTimeField("09:30")'), "09:30");
      assert.equal(s.run('parseTimeField("23:59")'), "23:59");
      assert.equal(s.run('parseTimeField("0000")'), "00:00");
      assert.equal(s.run('parseTimeField("9:30")'), null);
      assert.equal(s.run('parseTimeField("24:00")'), null);
      assert.equal(s.run('parseTimeField("12:60")'), null);
      assert.equal(s.run('parseTimeField("abc")'), null);
    });

    suite.test(`datepicker${tag}: toIso zero-pads month and day`, () => {
      const s = boot(variant);
      assert.equal(s.run("toIso(2024, 0, 5)"), "2024-01-05");
      assert.equal(s.run("toIso(2024, 11, 31)"), "2024-12-31");
    });
  }
}
