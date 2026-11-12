// Security rules for the packaged manifests.
//
// The rules are constants, not "whatever the manifest currently says": that is the
// whole point. A manifest change that widens the CSP, adds an API permission or
// broadens a host pattern must fail here and be justified in this file first.
import { readText } from "./source.mjs";

/* ---------- Content-Security-Policy ---------- */

// Directive by directive, because a missing or extra directive is a finding even
// when the resulting header still parses. The app loads only local assets, talks
// to two Google endpoints and embeds nothing.
export const EXPECTED_CSP = [
  ["default-src", "'none'"],
  ["script-src", "'self'"],
  ["style-src", "'self'"],
  ["img-src", "'self' data:"],
  ["connect-src", "https://www.googleapis.com https://oauth2.googleapis.com"],
  ["object-src", "'none'"],
  ["frame-src", "'none'"],
  ["form-action", "'none'"],
  ["base-uri", "'none'"],
];

export const EXPECTED_CSP_TEXT = EXPECTED_CSP.map(([name, value]) => `${name} ${value}`).join("; ");

export function normalizeCsp(policy) {
  return String(policy)
    .split(";")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("; ");
}

// -> { directives: Map<name, value>, duplicates: string[] }
export function parseCsp(policy) {
  const directives = new Map();
  const duplicates = [];
  for (const part of normalizeCsp(policy).split("; ")) {
    const [name, ...rest] = part.split(" ");
    if (directives.has(name)) duplicates.push(name);
    directives.set(name, rest.join(" "));
  }
  return { directives, duplicates };
}

// The extension policy as a single string: MV3 accepts a string, MV2/Firefox a
// { extension_pages } object. Returns null when neither shape is present.
export function extensionPolicy(csp) {
  if (typeof csp === "string") return csp;
  if (csp && typeof csp === "object" && typeof csp.extension_pages === "string") return csp.extension_pages;
  return null;
}

// Every difference between `policy` and EXPECTED_CSP, as human-readable lines.
export function cspDiff(policy) {
  const { directives, duplicates } = parseCsp(policy);
  const problems = [];
  for (const name of duplicates) problems.push(`CSP declares "${name}" more than once`);
  for (const [name, value] of EXPECTED_CSP) {
    if (!directives.has(name)) {
      problems.push(`CSP is missing "${name} ${value}"`);
    } else if (directives.get(name) !== value) {
      problems.push(`CSP "${name}" must be "${value}" (found "${directives.get(name)}")`);
    }
  }
  const expected = new Set(EXPECTED_CSP.map(([name]) => name));
  for (const [name, value] of directives) {
    if (!expected.has(name)) problems.push(`CSP has an unexpected directive "${name} ${value}"`);
  }
  return problems;
}

// Directive-level diff between two policies (used to prove both variants ship
// byte-identical policies).
export function cspDifference(a, b) {
  const left = parseCsp(a).directives;
  const right = parseCsp(b).directives;
  const names = [...new Set([...left.keys(), ...right.keys()])];
  const out = [];
  for (const name of names) {
    if (left.get(name) !== right.get(name)) {
      out.push(`${name}: "${left.get(name) ?? "<missing>"}" vs "${right.get(name) ?? "<missing>"}"`);
    }
  }
  return out;
}

/* ---------- Permissions ---------- */

// API permission names the extension is allowed to request, with the code that
// needs them. Adding a name here is a security decision: it must be justified by
// a real call site in extension/*/*.js, not by a feature wish.
export const API_PERMISSIONS = new Map([
  ["storage", "popup.js/background.js/sync.js keep tasks, projects and settings in storage.local/sync"],
  ["alarms", "background.js sync() schedules per-task reminders, the midnight badge refresh and the gsync poll"],
  ["notifications", "background.js notify()/addFromSelection() show task reminders"],
  ["contextMenus", "background.js setupMenu() adds the right-click \"add selection\" entry"],
  ["identity", "sync.js uses identity.getRedirectURL()/launchWebAuthFlow() for the Google OAuth token"],
  ["sidePanel", "background.js toggleSidebar() opens the Chrome side panel (chrome package only)"],
]);

// Any key starting with optional_ (optional_permissions, optional_host_permissions,
// ...) is refused outright: a permission the user can grant later still widens the
// attack surface, and the extension has no request-permission flow to justify one.
export const OPTIONAL_KEY = /^optional_/;

// Keys whose value is a permission list. Any other "*permissions" key is refused.
export const PERMISSION_KEYS = new Set(["permissions", "host_permissions"]);

/* ---------- Host permissions ---------- */

// Exact hosts only: the code calls these two endpoints and nothing else.
export const GOOGLE_HOSTS = new Set(["www.googleapis.com", "oauth2.googleapis.com"]);

// Firefox only: identity.getRedirectURL() derives https://<hash>.extensions.allizom.org/
// from the add-on id, and the Android tab-auth flow watches that URL. The hash is
// owned by Firefox, so the manifest carries the documented wildcard form instead of
// a hardcoded hash.
export const OAUTH_RETURN_SUFFIX = ".extensions.allizom.org";
export const OAUTH_RETURN_PATTERN = `https://*${OAUTH_RETURN_SUFFIX}/*`;

export function parseMatchPattern(entry) {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(String(entry).trim());
  if (!match) return null;
  return { scheme: match[1].toLowerCase(), host: match[2].toLowerCase(), path: match[3] === undefined ? "" : match[3] };
}

// null when the entry is acceptable, otherwise the reason it is refused.
export function hostPermissionProblem(variantId, entry) {
  if (typeof entry !== "string" || !entry.trim()) return "host permission entry is not a non-empty string";
  if (entry === "<all_urls>" || entry === "*" || entry === "/*") return `host permission "${entry}" is too broad`;

  const pattern = parseMatchPattern(entry);
  if (!pattern) return `host permission "${entry}" is not a valid match pattern`;
  const { scheme, host, path } = pattern;

  if (scheme !== "https") return `host permission "${entry}" must use https`;
  if (host.includes(":")) return `host permission "${entry}" must not contain a port`;
  if (host.includes("@")) return `host permission "${entry}" must not contain credentials`;
  if (host === "*") return `host permission "${entry}" is too broad (any https host)`;

  const wildcard = host.startsWith("*.");
  const base = wildcard ? host.slice(2) : host;
  if (base.includes("*")) return `host permission "${entry}" uses a wildcard outside the host prefix`;
  if (path !== "/*") return `host permission "${entry}" must cover all paths ("/*")`;

  if (GOOGLE_HOSTS.has(base) && !wildcard) return null;

  const isOAuthReturn = wildcard && base === OAUTH_RETURN_SUFFIX.slice(1);
  if (isOAuthReturn) {
    if (variantId !== "firefox") {
      return `host permission "${entry}" is the Firefox OAuth-return exception and must not appear in the ${variantId} manifest`;
    }
    return null;
  }

  return `host permission "${entry}" is outside the allow-list (exact: https://www.googleapis.com/*, https://oauth2.googleapis.com/*`
    + (variantId === "firefox" ? `, plus the OAuth return ${OAUTH_RETURN_PATTERN}` : "")
    + ")";
}

// Does a host permission pattern cover this absolute https URL? Used for the
// "host_permissions ⊇ the OAuth redirect base" contract.
export function hostPermissionCovers(entry, url) {
  const pattern = parseMatchPattern(entry);
  if (!pattern) return false;
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== `${pattern.scheme}:`) return false;

  const host = parsed.hostname.toLowerCase();
  const wildcard = pattern.host.startsWith("*.");
  const base = wildcard ? pattern.host.slice(2) : pattern.host;
  const hostOk = wildcard
    ? host.endsWith(`.${base}`) && host.length > base.length + 1
    : host === base;
  if (!hostOk) return false;

  if (pattern.path === "/*" || pattern.path === "") return true;
  const path = pattern.path.endsWith("*") ? pattern.path.slice(0, -1) : pattern.path;
  return `${parsed.pathname}${parsed.search}`.startsWith(path);
}

/* ---------- Manifest loading ---------- */

export function loadManifest(variant) {
  const rel = `${variant.dir}/manifest.json`;
  const text = readText(rel);
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${rel}: invalid JSON: ${error.message}`);
  }
  return { variant, rel, text, json };
}
