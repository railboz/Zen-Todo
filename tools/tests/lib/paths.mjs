// Repository facts shared by every check. Paths are relative to the repo root so
// the harness output is identical on any machine and in any worktree.
import path from "node:path";
import { fileURLToPath } from "node:url";

// tools/tests/lib/paths.mjs -> repo root
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const VARIANTS = [
  { id: "chrome", dir: "extension/zen-todo-3.1.3-chrome" },
  { id: "firefox", dir: "extension/zen-todo-3.1.4-firefox" },
];

// The 11 files that are meant to be shared byte-for-byte by both packaged
// variants. sidepanel.html is Chrome-only by design (Firefox reuses popup.html
// through sidebar_action) and is therefore not part of this list.
export const SHARED_FILES = [
  "background.js",
  "datepicker.js",
  "i18n.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "sync.js",
  "theme.css",
  "theme-init.js",
  "theme-modern.css",
  "util.js",
];

// Files allowed to exist in only one variant (extension -> reason).
export const VARIANT_ONLY_FILES = new Map([
  ["sidepanel.html", "Chrome side panel entry point redirects to popup.html; Firefox uses sidebar_action"],
]);

export const abs = (rel) => path.join(ROOT, rel);
