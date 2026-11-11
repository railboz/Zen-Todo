// Requirement 2: static security guardrails describing the TARGET state.
// Every violation is reported as <file>:<line> so it points at real code.
import { VARIANTS } from "../lib/paths.mjs";
import {
  isFile,
  listFiles,
  lineAt,
  parseAllowList,
  readText,
  stripHtmlComments,
  stripJsComments,
} from "../lib/source.mjs";

const SINKS = [
  ["innerHTML assignment", /\binnerHTML\s*=/g],
  ["outerHTML assignment", /\bouterHTML\s*=/g],
  ["insertAdjacentHTML call", /\binsertAdjacentHTML\s*\(/g],
  ["document.write call", /\bdocument\s*\.\s*write(?:ln)?\s*\(/g],
  ["eval call", /\beval\s*\(/g],
  ["new Function constructor", /\bnew\s+Function\s*\(/g],
];

const SECRETS = [
  ["Google API key literal", /AIza[0-9A-Za-z_-]{10,}/g],
  ["client_secret literal", /\bclient_secret\b/g],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["long base64 token", /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{60,}={0,2}(?![A-Za-z0-9+/=])/g],
];

const SINK_ALLOWLIST = "tools/tests/allow-sinks.txt";
const SECRET_ALLOWLIST = "tools/tests/allow-secrets.txt";

function allowed(allowEntries, candidate) {
  return allowEntries.some((entry) => entry.re.test(candidate));
}

function htmlFiles(variant) {
  return ["popup.html", "sidepanel.html"]
    .map((name) => `${variant.dir}/${name}`)
    .filter((rel) => isFile(rel));
}

// Return [{ tagName, index, raw }] for every start tag in an HTML document.
function htmlTags(source) {
  const tags = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)([^<>]*)>/g;
  let match;
  while ((match = re.exec(source))) {
    tags.push({ tagName: match[1].toLowerCase(), index: match.index, raw: match[0] });
  }
  return tags;
}

function scanSinks(variant, allowEntries) {
  const hits = [];
  const files = listFiles(variant.dir).filter((rel) => rel.endsWith(".js"));
  for (const rel of files) {
    const source = readText(rel);
    const code = stripJsComments(source);
    const lines = source.split("\n");
    for (const [label, pattern] of SINKS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(code))) {
        const line = lineAt(code, match.index);
        const candidate = `${rel}:${line}: ${(lines[line - 1] || "").trim()}`;
        if (!allowed(allowEntries, candidate)) hits.push({ rel, line, label });
        if (match.index === re.lastIndex) re.lastIndex++; // zero-length guard
      }
    }
  }
  return hits;
}

function scanInlineHandlers(variant) {
  const hits = [];
  for (const rel of htmlFiles(variant)) {
    const source = stripHtmlComments(readText(rel));
    for (const tag of htmlTags(source)) {
      const attr = /\son[a-z]+\s*=/gi;
      let match;
      while ((match = attr.exec(tag.raw))) {
        hits.push({ rel, line: lineAt(source, tag.index + match.index), what: `inline handler ${match[0].trim()}` });
      }
    }
    const jsUrl = /(?:href|src)\s*=\s*["']\s*javascript:/gi;
    let match;
    while ((match = jsUrl.exec(source))) {
      hits.push({ rel, line: lineAt(source, match.index), what: "javascript: URL" });
    }
  }
  return hits;
}

function scanRemoteAssets(variant) {
  const hits = [];
  for (const rel of htmlFiles(variant)) {
    const source = stripHtmlComments(readText(rel));
    for (const tag of htmlTags(source)) {
      if (tag.tagName !== "script" && tag.tagName !== "link") continue;
      const attr = /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      let match;
      while ((match = attr.exec(tag.raw))) {
        const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
        if (/^(?:https?:)?\/\//i.test(value)) {
          hits.push({ rel, line: lineAt(source, tag.index + match.index), what: `remote ${tag.tagName} ${match[1]}="${value}"` });
        }
      }
    }
  }
  for (const rel of listFiles(variant.dir).filter((file) => file.endsWith(".css"))) {
    const source = readText(rel);
    const patterns = [
      [/@import\s+(?:url\s*\(\s*)?["']?\s*(?:https?:)?\/\//gi, "remote @import"],
      [/url\s*\(\s*["']?\s*(?:https?:)?\/\//gi, "remote url() asset"],
    ];
    const seen = new Set();
    for (const [re, what] of patterns) {
      let match;
      while ((match = re.exec(source))) {
        const line = lineAt(source, match.index);
        const key = `${line}:${what}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ rel, line, what });
      }
    }
  }
  return hits;
}

function scanSecrets(variant, allowEntries) {
  const hits = [];
  const extensions = [".js", ".json", ".html", ".css"];
  const files = listFiles(variant.dir).filter((rel) => extensions.some((ext) => rel.endsWith(ext)));
  for (const rel of files) {
    const source = readText(rel);
    const lines = source.split("\n");
    for (const [label, pattern] of SECRETS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(source))) {
        const line = lineAt(source, match.index);
        const candidate = `${rel}:${line}: ${(lines[line - 1] || "").trim()}`;
        if (!allowed(allowEntries, candidate)) hits.push({ rel, line, label });
      }
    }
  }
  return hits;
}

export function register(suite) {
  for (const variant of VARIANTS) {
    suite.test(`security[${variant.id}]: no HTML/JS injection sinks`, () => {
      const allow = parseAllowList(SINK_ALLOWLIST);
      const hits = scanSinks(variant, allow);
      if (hits.length) {
        throw new Error(hits.map((hit) => `${hit.rel}:${hit.line}: ${hit.label}`).join("\n"));
      }
    });

    suite.test(`security[${variant.id}]: no inline event handlers or javascript: URLs`, () => {
      const hits = scanInlineHandlers(variant);
      if (hits.length) {
        throw new Error(hits.map((hit) => `${hit.rel}:${hit.line}: ${hit.what}`).join("\n"));
      }
    });

    suite.test(`security[${variant.id}]: no remote scripts, stylesheets or CSS assets`, () => {
      const hits = scanRemoteAssets(variant);
      if (hits.length) {
        throw new Error(hits.map((hit) => `${hit.rel}:${hit.line}: ${hit.what}`).join("\n"));
      }
    });

    suite.test(`security[${variant.id}]: no secret-looking literals`, () => {
      const allow = parseAllowList(SECRET_ALLOWLIST);
      const hits = scanSecrets(variant, allow);
      if (hits.length) {
        throw new Error(hits
          .map((hit) => `${hit.rel}:${hit.line}: ${hit.label} (value redacted)`)
          .join("\n"));
      }
    });
  }
}
