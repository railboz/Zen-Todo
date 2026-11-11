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
  and `script-src 'self'`; the CSP compared **directive by directive** against
  the constant `EXPECTED_CSP` (`lib/manifest-rules.mjs`: `default-src`,
  `script-src`, `style-src`, `img-src`, `connect-src`, `object-src`, `frame-src`,
  `form-action`, `base-uri`) and required to be the identical string in both
  variants; API permission **names** allow-listed one by one (with the call site
  that justifies each), any `optional_*` key refused, host permissions limited to
  the exact patterns `https://www.googleapis.com/*` and
  `https://oauth2.googleapis.com/*` (no `*.googleapis.com`) plus, for Firefox
  only, the single OAuth-return wildcard `https://*.extensions.allizom.org/*`;
  the host matcher is self-tested against near-miss hosts so the exception stays
  fail-closed; valid semver, identical in both variants; no `update_url`; every
  referenced file exists; no undocumented duplicate reference.
- `checks/manifest-contract.mjs` - CSP/host_permissions vs. what the JS really
  does. Extracts every absolute `https://` origin from the packaged JS (literals
  and `const NAME = "https://..."` bindings) at `fetch()` / `XMLHttpRequest` /
  `identity.launchWebAuthFlow()` call sites, then asserts: `connect-src` covers
  every origin the code connects to **and lists nothing the code never uses**;
  `launchWebAuthFlow()` only opens the OAuth authorize host
  (`accounts.google.com`); every other origin in the JS is one of those two
  groups or the OAuth redirect base; and Firefox `host_permissions` cover the
  `identity.getRedirectURL()` fallback base found in `sync.js`. Static regex
  analysis, no browser, no network.
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
- The CSP, the permission names and the host patterns are **not** allow-list
  files: they are constants in `lib/manifest-rules.mjs`, so relaxing one is a
  code diff with a justification comment, reviewed like any other change.

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
- The manifest contract resolves literal URLs and `const NAME = "https://..."`
  bindings only. A URL assembled at runtime (a function parameter such as
  `gfetch(url)`, a decoded string, a template built from two variables) is not
  resolved; `lib/manifest-rules.mjs` stays the backstop for those.
