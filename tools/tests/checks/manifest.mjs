// Requirements 2 (manifest) and 5 (file integrity).
import { VARIANTS } from "../lib/paths.mjs";
import { isFile, lineOf, parseAllowList, readText } from "../lib/source.mjs";

const DUP_ALLOWLIST = "tools/tests/allow-dup-refs.txt";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const GOOGLE_HOST = /^(?:\*\.)?(?:www\.|oauth2\.)?googleapis\.com$/;
// Firefox only: identity.getRedirectURL() returns https://<hash>.extensions.allizom.org/
// (sync.js:34), the OAuth return origin the Android tab flow observes. Kept as the single
// non-Google exception so that "tabs" (all tab URLs) is not requested.
const FIREFOX_OAUTH_HOST = /^\*\.extensions\.allizom\.org$/;

function loadManifest(variant) {
  const rel = `${variant.dir}/manifest.json`;
  const text = readText(rel);
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${rel}: invalid JSON: ${err.message}`);
  }
  return { variant, rel, text, json };
}

function cspDirectives(policy) {
  return policy.split(";").map((part) => part.trim()).filter(Boolean);
}

function findKey(value, key, path = "") {
  if (!value || typeof value !== "object") return null;
  for (const [name, child] of Object.entries(value)) {
    const next = path ? `${path}.${name}` : name;
    if (name === key) return next;
    const found = findKey(child, key, next);
    if (found) return found;
  }
  return null;
}

function collectRefs(manifest) {
  const refs = [];
  const add = (label, value) => {
    if (typeof value === "string" && value.trim()) refs.push({ label, value: value.trim() });
  };
  const addIcons = (label, icons) => {
    if (!icons || typeof icons !== "object") return;
    for (const [size, path] of Object.entries(icons)) add(`${label}[${size}]`, path);
  };

  const background = manifest.background || {};
  add("background.service_worker", background.service_worker);
  (Array.isArray(background.scripts) ? background.scripts : [])
    .forEach((path, index) => add(`background.scripts[${index}]`, path));

  add("action.default_popup", manifest.action && manifest.action.default_popup);
  addIcons("action.default_icon", manifest.action && manifest.action.default_icon);
  addIcons("icons", manifest.icons);
  add("side_panel.default_path", manifest.side_panel && manifest.side_panel.default_path);
  add("sidebar_action.default_panel", manifest.sidebar_action && manifest.sidebar_action.default_panel);
  addIcons("sidebar_action.default_icon", manifest.sidebar_action && manifest.sidebar_action.default_icon);
  add("options_ui.page", manifest.options_ui && manifest.options_ui.page);
  add("devtools_page", manifest.devtools_page);

  for (const [key, path] of Object.entries(manifest.chrome_url_overrides || {})) {
    add(`chrome_url_overrides.${key}`, path);
  }
  (Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).forEach((entry, index) => {
    (entry.js || []).forEach((path, j) => add(`content_scripts[${index}].js[${j}]`, path));
    (entry.css || []).forEach((path, j) => add(`content_scripts[${index}].css[${j}]`, path));
  });
  (Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : []).forEach((entry, index) => {
    (entry.resources || []).forEach((path, j) => add(`web_accessible_resources[${index}].resources[${j}]`, path));
  });

  return refs;
}

function isCheckablePath(value) {
  if (/^(?:https?:)?\/\//i.test(value)) return false;
  if (value.includes("*")) return false;
  return true;
}

export function register(suite) {
  const manifests = new Map(VARIANTS.map((variant) => [variant.id, loadManifest(variant)]));

  for (const variant of VARIANTS) {
    const { rel, text, json } = manifests.get(variant.id);

    suite.test(`manifest[${variant.id}]: valid MV3 manifest`, () => {
      if (json.manifest_version !== 3) throw new Error(`${rel}:1: manifest_version must be 3`);
      if (typeof json.name !== "string" || !json.name.trim()) throw new Error(`${rel}:1: name is missing`);
    });

    suite.test(`manifest[${variant.id}]: content_security_policy present without unsafe-eval`, () => {
      const csp = json.content_security_policy;
      const cspLine = lineOf(text, '"content_security_policy"') || 1;
      if (!csp) throw new Error(`${rel}:${cspLine}: content_security_policy is missing`);

      const policy = typeof csp === "string" ? csp : csp.extension_pages;
      if (typeof policy !== "string" || !policy.trim()) {
        throw new Error(`${rel}:${cspLine}: content_security_policy.extension_pages is missing`);
      }

      const problems = [];
      if (/unsafe-eval/i.test(policy)) {
        problems.push(`${rel}:${lineOf(text, "unsafe-eval") || cspLine}: CSP allows unsafe-eval`);
      }
      if (/unsafe-inline/i.test(policy)) {
        problems.push(`${rel}:${lineOf(text, "unsafe-inline") || cspLine}: CSP allows unsafe-inline`);
      }
      const scriptSrc = cspDirectives(policy).find((part) => part.startsWith("script-src"));
      if (!scriptSrc) {
        problems.push(`${rel}:${cspLine}: CSP has no script-src directive`);
      } else if (scriptSrc.replace(/\s+/g, " ") !== "script-src 'self'") {
        problems.push(`${rel}:${cspLine}: script-src must be exactly "'self'" (found: ${scriptSrc})`);
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    suite.test(`manifest[${variant.id}]: permissions stay within the Google API allow-list`, () => {
      const entries = [...(json.permissions || []), ...(json.host_permissions || [])];
      const problems = [];
      for (const entry of entries) {
        if (typeof entry !== "string") {
          problems.push(`${rel}:1: permission entry is not a string`);
          continue;
        }
        const line = lineOf(text, JSON.stringify(entry)) || 1;
        if (entry === "<all_urls>" || entry === "*") {
          problems.push(`${rel}:${line}: permission "${entry}" is too broad`);
          continue;
        }
        const scheme = entry.indexOf("://");
        if (scheme === -1) continue;
        const host = entry.slice(scheme + 3).split("/")[0].split(":")[0];
        const allowed = GOOGLE_HOST.test(host) || (variant.id === "firefox" && FIREFOX_OAUTH_HOST.test(host));
        if (!allowed) {
          problems.push(`${rel}:${line}: host permission "${entry}" is outside the Google API allow-list`);
        }
        if (!entry.startsWith("https://")) {
          problems.push(`${rel}:${line}: host permission "${entry}" must use https`);
        }
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    suite.test(`manifest[${variant.id}]: no update_url`, () => {
      const where = findKey(json, "update_url");
      if (where) {
        throw new Error(`${rel}:${lineOf(text, '"update_url"') || 1}: update_url is not allowed (${where}); updates must stay store-managed`);
      }
    });

    suite.test(`manifest[${variant.id}]: every referenced file exists`, () => {
      const refs = collectRefs(json);
      const problems = [];
      for (const ref of refs) {
        if (!isCheckablePath(ref.value)) continue;
        const normalized = ref.value.replace(/^\.\//, "");
        const line = lineOf(text, JSON.stringify(ref.value)) || 1;
        if (normalized.startsWith("../") || normalized.includes("/../")) {
          problems.push(`${rel}:${line}: ${ref.label} points outside the extension ("${ref.value}")`);
          continue;
        }
        if (!isFile(`${variant.dir}/${normalized}`)) {
          problems.push(`${rel}:${line}: ${ref.label} references missing file "${ref.value}"`);
        }
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    suite.test(`manifest[${variant.id}]: no file referenced twice`, () => {
      const allow = parseAllowList(DUP_ALLOWLIST);
      const refs = collectRefs(json);
      const groups = new Map();
      for (const ref of refs) {
        const key = ref.value.replace(/^\.\//, "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ref);
      }
      const problems = [];
      for (const [path, entries] of groups) {
        if (entries.length < 2) continue;
        if (allow.some((entry) => entry.re.test(path))) continue;
        const line = lineOf(text, JSON.stringify(path)) || 1;
        const labels = entries.map((entry) => entry.label).join(", ");
        problems.push(`${rel}:${line}: "${path}" is referenced ${entries.length} times (${labels})`);
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });
  }

  suite.test("manifest: version is semver and identical across variants", () => {
    const problems = [];
    for (const variant of VARIANTS) {
      const { rel, text, json } = manifests.get(variant.id);
      const line = lineOf(text, '"version"') || 1;
      if (typeof json.version !== "string" || !SEMVER.test(json.version)) {
        problems.push(`${rel}:${line}: version "${json.version}" is not valid semver`);
      }
    }
    const chrome = manifests.get("chrome").json.version;
    const firefox = manifests.get("firefox").json.version;
    if (chrome !== firefox) {
      const c = manifests.get("chrome");
      const f = manifests.get("firefox");
      problems.push(`${c.rel}:${lineOf(c.text, '"version"') || 1}: version ${chrome} differs from ${f.rel}:${lineOf(f.text, '"version"') || 1}: version ${firefox}`);
    }
    if (problems.length) throw new Error(problems.join("\n"));
  });
}
