// Requirement: the CSP and host_permissions must describe what the JS really does.
//
// Static analysis only (no network, no browser): every absolute https origin in the
// packaged JS is collected from literals and single-identifier constants. That is
// enough because this codebase builds its URLs from `const SYNC_API = "https://..."`
// bindings, and it keeps the check dependency-free and deterministic.
//
// Direction 1 (coverage): an origin the code fetches must be allowed by connect-src.
// Direction 2 (closure): connect-src must not allow anything the code never fetches,
// so a `connect-src https://exfil.evil.com` padding shows up as an unused entry even
// if someone also relaxes the expected-policy constant.
import { VARIANTS } from "../lib/paths.mjs";
import { lineAt, lineOf, listFiles, readText, stripJsComments } from "../lib/source.mjs";
import {
  OAUTH_RETURN_PATTERN,
  OAUTH_RETURN_SUFFIX,
  extensionPolicy,
  hostPermissionCovers,
  loadManifest,
  parseCsp,
} from "../lib/manifest-rules.mjs";

// The authorize page is opened in a browser window by identity.launchWebAuthFlow()
// (and by tabs.create() on Firefox Android): a navigation, not a connection. Neither
// connect-src nor host_permissions apply to it, so it gets its own exact allow-list.
const OAUTH_AUTHORIZE_HOSTS = new Set(["accounts.google.com"]);

const URL_LITERAL = /https:\/\/[^\s"'`)\\,;]+/g;

// Lower-cased authority ("host" or "host:port"); null when the literal has no host.
function authorityOf(url) {
  const match = /^https:\/\/([^/?#]+)/.exec(url);
  return match ? match[1].toLowerCase() : null;
}

function literalsIn(code) {
  const out = [];
  const re = new RegExp(URL_LITERAL.source, "g");
  let match;
  while ((match = re.exec(code))) {
    out.push({ url: match[0], host: authorityOf(match[0]), index: match.index });
  }
  return out;
}

// `const NAME = "https://..."` bindings, used to resolve fetch(SYNC_API + "/path").
function constantUrls(code) {
  const map = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])(https:\/\/[^"'`]+)\2/g;
  let match;
  while ((match = re.exec(code))) map.set(match[1], match[3]);
  return map;
}

// Text of the first argument of a call whose "(" ends at `start`, quote-aware and
// depth-aware, stopping at the matching ")" or at a top-level ",".
function firstArgument(code, start) {
  let depth = 0;
  let quote = "";
  let i = start;
  for (; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) break;
  }
  return { text: code.slice(start, i), index: start };
}

function resolveExpression(file, expression) {
  const found = [];
  for (const literal of literalsIn(expression.text)) {
    found.push({ host: literal.host, url: literal.url, index: expression.index + literal.index });
  }
  for (const [name, value] of file.constants) {
    if (new RegExp(`\\b${name}\\b`).test(expression.text)) {
      found.push({ host: authorityOf(value), url: value, index: expression.index });
    }
  }
  return found;
}

// Every origin the code sends a request to, with `fetch()` / `XMLHttpRequest`
// (connections) separated from `identity.launchWebAuthFlow` (navigation).
function networkSinks(file) {
  const connections = [];
  const navigations = [];
  const push = (list, sink, target) => {
    if (target.host) list.push({ sink, ...target, rel: file.rel, line: lineAt(file.code, target.index) });
  };

  const fetchRe = /\bfetch\s*\(/g;
  let match;
  while ((match = fetchRe.exec(file.code))) {
    const argument = firstArgument(file.code, match.index + match[0].length);
    for (const target of resolveExpression(file, argument)) push(connections, "fetch()", target);
  }

  if (/\bnew\s+XMLHttpRequest\b/.test(file.code)) {
    const openRe = /\.open\s*\(\s*(["'])([A-Za-z]+)\1\s*,\s*/g;
    while ((match = openRe.exec(file.code))) {
      const argument = firstArgument(file.code, match.index + match[0].length);
      for (const target of resolveExpression(file, argument)) push(connections, "XMLHttpRequest", target);
    }
  }

  const authRe = /\.launchWebAuthFlow\s*\(/g;
  while ((match = authRe.exec(file.code))) {
    const argument = firstArgument(file.code, match.index + match[0].length);
    const url = /\burl\s*:\s*([^,}]+)/.exec(argument.text);
    if (!url) continue;
    const start = argument.index + url.index + url[0].length - url[1].length;
    for (const target of resolveExpression(file, { text: url[1], index: start })) {
      push(navigations, "identity.launchWebAuthFlow()", target);
    }
  }

  return { connections, navigations };
}

function loadJsFiles(variant) {
  return listFiles(variant.dir)
    .filter((rel) => rel.endsWith(".js"))
    .map((rel) => {
      const source = readText(rel);
      const code = stripJsComments(source);
      return { rel, code, constants: constantUrls(code) };
    });
}

function connectSrcOrigins(variant, rel, text, json) {
  const policy = extensionPolicy(json.content_security_policy);
  if (policy === null) {
    return { origins: new Set(), problems: [`${rel}:${lineOf(text, '"content_security_policy"') || 1}: content_security_policy is missing`] };
  }
  const value = parseCsp(policy).directives.get("connect-src");
  if (value === undefined) {
    return { origins: new Set(), problems: [`${rel}:${lineOf(text, '"content_security_policy"') || 1}: CSP has no connect-src directive`] };
  }
  const origins = new Set();
  const problems = [];
  const line = lineOf(text, '"content_security_policy"') || 1;
  for (const token of value.split(" ").filter(Boolean)) {
    if (!token.startsWith("https://") || /[/?#]/.test(token.slice("https://".length))) {
      problems.push(`${rel}:${line}: connect-src entry "${token}" must be a bare https origin`);
      continue;
    }
    origins.add(token);
  }
  return { origins, problems };
}

export function register(suite) {
  const manifests = new Map(VARIANTS.map((variant) => [variant.id, loadManifest(variant)]));
  const files = new Map(VARIANTS.map((variant) => [variant.id, loadJsFiles(variant)]));

  for (const variant of VARIANTS) {
    const { rel, text, json } = manifests.get(variant.id);
    const jsFiles = files.get(variant.id);

    suite.test(`manifest[${variant.id}]: connect-src matches the origins the code connects to`, () => {
      const declared = connectSrcOrigins(variant, rel, text, json);
      const problems = [...declared.problems];
      const used = new Map();
      for (const file of jsFiles) {
        for (const target of networkSinks(file).connections) {
          if (!used.has(target.host)) used.set(target.host, target);
        }
      }
      for (const [host, target] of used) {
        if (!declared.origins.has(`https://${host}`)) {
          problems.push(`${target.rel}:${target.line}: ${target.sink} connects to https://${host}, which connect-src does not allow`);
        }
      }
      for (const origin of declared.origins) {
        if (!used.has(origin.slice("https://".length))) {
          const line = lineOf(text, '"content_security_policy"') || 1;
          problems.push(`${rel}:${line}: connect-src allows ${origin} but no fetch()/XMLHttpRequest in the ${variant.id} package targets it`);
        }
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    suite.test(`manifest[${variant.id}]: identity.launchWebAuthFlow only opens the Google authorize endpoint`, () => {
      const problems = [];
      for (const file of jsFiles) {
        for (const target of networkSinks(file).navigations) {
          if (!OAUTH_AUTHORIZE_HOSTS.has(target.host)) {
            problems.push(`${target.rel}:${target.line}: ${target.sink} opens https://${target.host}, which is not an allow-listed OAuth authorize host (${[...OAUTH_AUTHORIZE_HOSTS].join(", ")})`);
          }
        }
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    suite.test(`manifest[${variant.id}]: every https origin in the code is declared`, () => {
      const declared = connectSrcOrigins(variant, rel, text, json);
      const problems = [...declared.problems];
      for (const file of jsFiles) {
        for (const literal of literalsIn(file.code)) {
          const host = literal.host;
          if (!host) {
            problems.push(`${file.rel}:${lineAt(file.code, literal.index)}: "${literal.url}" has no usable host`);
            continue;
          }
          if (declared.origins.has(`https://${host}`)) continue;
          if (OAUTH_AUTHORIZE_HOSTS.has(host)) continue;
          if (host.endsWith(OAUTH_RETURN_SUFFIX) && host.length > OAUTH_RETURN_SUFFIX.length) continue;
          problems.push(`${file.rel}:${lineAt(file.code, literal.index)}: origin https://${host} is neither in connect-src nor the OAuth authorize/redirect endpoint`);
        }
      }
      if (problems.length) throw new Error([...new Set(problems)].join("\n"));
    });
  }

  // Firefox is the package whose Android tab flow watches the redirect URL, so its
  // host_permissions must cover the identity.getRedirectURL() fallback literal that
  // sync.js ships. Chrome always has identity.getRedirectURL(), so it needs no
  // allizom permission (and the host allow-list refuses one there).
  suite.test("manifest: firefox host_permissions cover the OAuth redirect base from sync.js", () => {
    const { rel, text, json } = manifests.get("firefox");
    const bases = [];
    for (const file of files.get("firefox")) {
      for (const literal of literalsIn(file.code)) {
        if (!literal.host || !literal.host.endsWith(OAUTH_RETURN_SUFFIX)) continue;
        if (literal.host.length <= OAUTH_RETURN_SUFFIX.length) continue;
        bases.push({ url: literal.url, rel: file.rel, line: lineAt(file.code, literal.index) });
      }
    }
    const problems = [];
    if (!bases.length) {
      problems.push(`${rel}: no OAuth redirect base (https://<hash>${OAUTH_RETURN_SUFFIX}/) found in the firefox JS; the contract check needs to be revisited`);
    }
    const entries = Array.isArray(json.host_permissions) ? json.host_permissions : [];
    for (const base of bases) {
      if (!entries.some((entry) => hostPermissionCovers(entry, base.url))) {
        problems.push(`${base.rel}:${base.line}: OAuth redirect base ${base.url} is not covered by any firefox host_permission (expected ${OAUTH_RETURN_PATTERN})`);
      }
    }
    // Fail-closed self-test of the coverage helper: the documented wildcard must not
    // cover the bare domain nor a look-alike suffix.
    const nearMisses = [
      "https://extensions.allizom.org/",
      "https://allizom.org/",
      "https://evil.extensions.allizom.org.attacker.test/",
      "https://extensions.allizom.org.attacker.test/",
    ];
    if (!hostPermissionCovers(OAUTH_RETURN_PATTERN, `https://0123456789abcdef${OAUTH_RETURN_SUFFIX}/`)) {
      problems.push(`REGRESSION: ${OAUTH_RETURN_PATTERN} no longer covers a redirect URL it must cover`);
    }
    for (const url of nearMisses) {
      if (hostPermissionCovers(OAUTH_RETURN_PATTERN, url)) {
        problems.push(`REGRESSION: ${OAUTH_RETURN_PATTERN} wrongly covers ${url}`);
      }
    }
    if (problems.length) throw new Error(problems.join("\n"));
  });
}
