// Requirements 2 (manifest) and 5 (file integrity).
//
// The CSP and the permission lists are compared against the constants in
// lib/manifest-rules.mjs, never against "whatever the manifest says": a manifest
// edit that widens the policy or adds a capability must fail here.
import { VARIANTS } from "../lib/paths.mjs";
import { isFile, lineOf, parseAllowList, readText } from "../lib/source.mjs";
import {
  API_PERMISSIONS,
  EXPECTED_CSP_TEXT,
  OPTIONAL_KEY,
  PERMISSION_KEYS,
  cspDiff,
  cspDifference,
  extensionPolicy,
  hostPermissionProblem,
  loadManifest,
  normalizeCsp,
} from "../lib/manifest-rules.mjs";

const DUP_ALLOWLIST = "tools/tests/allow-dup-refs.txt";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

// Every key in the manifest (nested included) whose name matches `pattern`.
function keysMatching(value, pattern, path = "") {
  const found = [];
  if (!value || typeof value !== "object") return found;
  for (const [name, child] of Object.entries(value)) {
    const next = path ? `${path}.${name}` : name;
    if (pattern.test(name)) found.push({ path: next, name, value: child });
    found.push(...keysMatching(child, pattern, next));
  }
  return found;
}

function entryLine(text, entry) {
  return lineOf(text, JSON.stringify(entry)) || 1;
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

      const policy = extensionPolicy(csp);
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
      const scriptSrc = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src"));
      if (!scriptSrc) {
        problems.push(`${rel}:${cspLine}: CSP has no script-src directive`);
      } else if (scriptSrc.replace(/\s+/g, " ") !== "script-src 'self'") {
        problems.push(`${rel}:${cspLine}: script-src must be exactly "'self'" (found: ${scriptSrc})`);
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    // A CSP that merely "parses" is not enough: any added source (an exfil host in
    // connect-src, a CDN in script-src) or any dropped directive must fail.
    suite.test(`manifest[${variant.id}]: content_security_policy matches the expected policy exactly`, () => {
      const cspLine = lineOf(text, '"content_security_policy"') || 1;
      const policy = extensionPolicy(json.content_security_policy);
      if (policy === null) throw new Error(`${rel}:${cspLine}: content_security_policy is missing`);
      const problems = cspDiff(policy).map((problem) => `${rel}:${cspLine}: ${problem}`);
      if (normalizeCsp(policy) !== EXPECTED_CSP_TEXT) {
        problems.push(`${rel}:${cspLine}: expected exactly "${EXPECTED_CSP_TEXT}"`);
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    // Permission *names*: a mutation adding "debugger", "proxy" or "cookies" would
    // still be "a permission", so the allow-list has to name every API explicitly.
    suite.test(`manifest[${variant.id}]: API permission names stay within the allow-list`, () => {
      const problems = [];

      for (const key of Object.keys(json).filter((name) => /permissions$/.test(name))) {
        if (OPTIONAL_KEY.test(key)) continue; // reported below with its own message
        if (!PERMISSION_KEYS.has(key)) {
          problems.push(`${rel}:${lineOf(text, JSON.stringify(key)) || 1}: unknown permission key "${key}" is not allowed`);
        }
      }

      // optional_permissions / optional_host_permissions: granting them later still
      // widens the surface, and nothing in the extension asks for them.
      for (const hit of keysMatching(json, OPTIONAL_KEY)) {
        problems.push(`${rel}:${lineOf(text, JSON.stringify(hit.name)) || 1}: "${hit.path}" is not allowed; every permission must be reviewed at install time`);
      }

      const permissions = json.permissions;
      if (!Array.isArray(permissions)) {
        problems.push(`${rel}:${lineOf(text, '"permissions"') || 1}: permissions must be an array`);
      } else {
        const seen = new Set();
        for (const name of permissions) {
          if (typeof name !== "string" || !name.trim()) {
            problems.push(`${rel}:${lineOf(text, '"permissions"') || 1}: permission entry is not a non-empty string`);
            continue;
          }
          const line = entryLine(text, name);
          if (seen.has(name)) problems.push(`${rel}:${line}: permission "${name}" is listed twice`);
          seen.add(name);
          if (!API_PERMISSIONS.has(name)) {
            problems.push(`${rel}:${line}: API permission "${name}" is not in the documented allow-list (tools/tests/lib/manifest-rules.mjs)`);
          }
        }
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
        if (entry.indexOf("://") === -1) {
          // API permission name: reviewed by the allow-list test above.
          if (!API_PERMISSIONS.has(entry)) {
            problems.push(`${rel}:${line}: API permission "${entry}" is not in the documented allow-list`);
          }
          continue;
        }
        const problem = hostPermissionProblem(variant.id, entry);
        if (problem) problems.push(`${rel}:${line}: ${problem}`);
      }
      if (problems.length) throw new Error(problems.join("\n"));
    });

    // Exact hosts only. A wildcard such as https://*.googleapis.com/* silently
    // authorises every Google API project, not just the two endpoints in use.
    suite.test(`manifest[${variant.id}]: host permissions are the exact documented patterns`, () => {
      const cspLine = lineOf(text, '"host_permissions"') || 1;
      const entries = json.host_permissions;
      if (!Array.isArray(entries)) {
        throw new Error(`${rel}:${cspLine}: host_permissions must be an array`);
      }
      const problems = [];
      const seen = new Set();
      for (const entry of entries) {
        const line = entryLine(text, entry);
        const problem = hostPermissionProblem(variant.id, entry);
        if (problem) problems.push(`${rel}:${line}: ${problem}`);
        if (typeof entry === "string") {
          if (seen.has(entry)) problems.push(`${rel}:${line}: host permission "${entry}" is listed twice`);
          seen.add(entry);
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

  // Both packages run the same code, so a policy divergence is either a mistake or
  // an unreviewed exception: the strings must be identical.
  suite.test("manifest: CSP is identical across variants", () => {
    const values = VARIANTS.map((variant) => {
      const entry = manifests.get(variant.id);
      return { ...entry, policy: extensionPolicy(entry.json.content_security_policy) };
    });
    const missing = values.filter((entry) => entry.policy === null);
    if (missing.length) {
      throw new Error(missing
        .map((entry) => `${entry.rel}:${lineOf(entry.text, '"content_security_policy"') || 1}: content_security_policy is missing`)
        .join("\n"));
    }
    const [chrome, firefox] = values;
    if (normalizeCsp(chrome.policy) === normalizeCsp(firefox.policy)) return;
    const diff = cspDifference(chrome.policy, firefox.policy);
    throw new Error(
      `${chrome.rel}:${lineOf(chrome.text, '"content_security_policy"') || 1}: CSP differs from `
      + `${firefox.rel}:${lineOf(firefox.text, '"content_security_policy"') || 1}\n`
      + diff.map((line) => `  ${line}`).join("\n"),
    );
  });

  // Self-test of the host rule: the OAuth-return wildcard is the only non-Google
  // entry allowed anywhere, and near-miss hosts must stay refused (fail-closed).
  suite.test("manifest: host allow-list matcher refuses near-miss hosts", () => {
    const allowed = [
      ["chrome", "https://www.googleapis.com/*"],
      ["chrome", "https://oauth2.googleapis.com/*"],
      ["firefox", "https://www.googleapis.com/*"],
      ["firefox", "https://*.extensions.allizom.org/*"],
    ];
    const refused = [
      ["chrome", "https://*.googleapis.com/*"],
      ["firefox", "https://*.googleapis.com/*"],
      ["chrome", "https://googleapis.com/*"],
      ["firefox", "https://foo.googleapis.com/*"],
      ["chrome", "https://oauth2.googleapis.com.evil.com/*"],
      ["chrome", "https://www.googleapis.com:8443/*"],
      ["chrome", "https://user@www.googleapis.com/*"],
      ["chrome", "https://www.googleapis.com/drive/*"],
      ["chrome", "http://www.googleapis.com/*"],
      ["chrome", "ftp://www.googleapis.com/*"],
      ["chrome", "<all_urls>"],
      ["chrome", "*"],
      ["firefox", "https://*/"],
      ["chrome", "https://*.extensions.allizom.org/*"],
      ["firefox", "https://extensions.allizom.org/*"],
      ["firefox", "https://allizom.org/*"],
      ["firefox", "https://*.allizom.org/*"],
      ["firefox", "https://*.extensions.allizom.org.evil.com/*"],
      ["firefox", "https://evil.extensions.allizom.org@evil.com/*"],
      ["firefox", "https://*.extensions.allizom.org"],
      ["firefox", ""],
    ];
    const problems = [];
    for (const [variantId, entry] of allowed) {
      const problem = hostPermissionProblem(variantId, entry);
      if (problem) problems.push(`REGRESSION: "${entry}" (${variantId}) must be allowed but was refused: ${problem}`);
    }
    for (const [variantId, entry] of refused) {
      if (hostPermissionProblem(variantId, entry) === null) {
        problems.push(`REGRESSION: "${entry}" (${variantId}) is too broad but was accepted`);
      }
    }
    if (problems.length) throw new Error(problems.join("\n"));
  });

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
