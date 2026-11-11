# Extension test harness (static + unit)

Independent acceptance gate for the Zen Todo security/performance rework.
No browser, no network, no npm dependencies, Node 20+ only.

```sh
node tools/tests/run.mjs
```

Output is one line per check (`✔` / `✘`), failure details below the check with
`file:line` evidence, and a final `PASS n / FAIL m`. Exit code is 1 when any
check fails, 0 otherwise. Output is deterministic (sorted files, no timings, no
absolute paths).

## What is checked

- `checks/syntax.mjs` - every `.js` file in both variants parses (`vm.Script`).
- `checks/security.mjs` - no `innerHTML =` / `outerHTML =` /
  `insertAdjacentHTML(` / `document.write(` / `eval(` / `new Function(`, no
  inline `on*=` handlers or `javascript:` URLs in HTML, no remote
  script/stylesheet/CSS asset, no secret-looking literals (API key,
  `client_secret`, private key block, long base64 token).
- `checks/manifest.mjs` - explicit CSP without `unsafe-eval`/`unsafe-inline`
  and `script-src 'self'`; permissions/host permissions limited to Google API
  hosts; valid semver, identical in both variants; no `update_url`; every
  referenced file exists; no undocumented duplicate reference.
- `checks/drift.mjs` - the 11 shared JS/HTML/CSS files exist in both variants
  and are byte-identical, with the first differing hunk on failure. A new
  shared file must be added to `SHARED_FILES` in `lib/paths.mjs`.
- `unit/*.test.mjs` - real `util.js`, `i18n.js` and `datepicker.js` are loaded
  in a `vm` sandbox with `fake-chrome.mjs` (in-memory `storage.local/sync`,
  no-op runtime messaging) and a fixed `Date`. Covers validation/sanitisation,
  reminder time, stable ids, i18n interpolation + English fallback +
  `textContent`-only rendering, and date/time parsing per locale.
- `unit/fake-chrome.test.mjs` - self-tests of the test double.

The extension files are never modified by this harness: checks only read them.

## Allow-lists

- `allow-sinks.txt`, `allow-secrets.txt`, `allow-dup-refs.txt`.
- Format: `<regex or path> | <justification>`. Lines starting with `#` are
  comments. An entry without a justification aborts the run, so exceptions are
  always documented and reviewable.

## Not covered (by design, no browser)

- DOM rendering paths (`createDatePicker`, `createTimePicker`, popup rendering):
  they need a real DOM; only their pure parse/format helpers are tested.
- Runtime OAuth token lifecycle and `runtime.onMessage` validation beyond the
  static patterns above: these need integration tests with a browser.
- Performance budgets: no timing assertions here (flaky by nature); this
  harness only guards correctness/security invariants.
- `vm` comment stripping does not tokenise regex literals; a regex containing
  `//` or a quote could confuse the sink scan (use the allow-list if that day
  ever comes).
