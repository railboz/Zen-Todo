// File/string helpers for the static checks. Everything works on paths relative
// to the repo root so failure messages can be copy-pasted into a terminal.
import fs from "node:fs";
import path from "node:path";
import { ROOT, abs } from "./paths.mjs";

const toPosix = (p) => p.split(path.sep).join("/");

export function readText(rel) {
  return fs.readFileSync(abs(rel), "utf8");
}

export function isFile(rel) {
  try {
    return fs.statSync(abs(rel)).isFile();
  } catch {
    return false;
  }
}

export function listFiles(relDir) {
  const out = [];
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(toPosix(path.relative(ROOT, full)));
    }
  };
  visit(abs(relDir));
  return out.sort();
}

export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export function lineOf(text, needle, occurrence = 1) {
  if (!needle) return null;
  let from = 0;
  let seen = 0;
  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return null;
    seen++;
    if (seen === occurrence) return lineAt(text, index);
    from = index + needle.length;
  }
}

// Replace comments with spaces, preserving offsets and newlines, so line
// numbers computed on the cleaned text match the original file. String and
// template literals are skipped while looking for comment markers (a URL
// "https://..." inside a string is not a comment).
//
// Limitation: regex literals are not tokenised. A regex containing "//" or a
// quote could confuse this scanner; no such regex exists in the sources today,
// and the sink allow-list is the escape hatch if one is ever needed.
export function stripJsComments(src) {
  const out = src.split("");
  let i = 0;
  let state = "code";
  let quote = "";
  const blank = (index) => {
    if (out[index] !== "\n") out[index] = " ";
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (state === "code") {
      if (c === "/" && next === "/") {
        blank(i); blank(i + 1);
        state = "line";
        i += 2;
      } else if (c === "/" && next === "*") {
        blank(i); blank(i + 1);
        state = "block";
        i += 2;
      } else if (c === "'" || c === '"' || c === "`") {
        quote = c;
        state = "string";
        i++;
      } else {
        i++;
      }
      continue;
    }

    if (state === "line") {
      if (c === "\n") state = "code";
      else blank(i);
      i++;
      continue;
    }

    if (state === "block") {
      if (c === "*" && next === "/") {
        blank(i); blank(i + 1);
        state = "code";
        i += 2;
      } else {
        blank(i);
        i++;
      }
      continue;
    }

    // state === "string": leave content untouched, only track the closing quote.
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) {
      state = "code";
      i++;
      continue;
    }
    if (c === "\n" && quote !== "`") {
      // Unterminated single-line string: recover instead of swallowing the file.
      state = "code";
      i++;
      continue;
    }
    i++;
  }

  return out.join("");
}

export function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
}

// Allow-list format: one entry per line, "<regex> | <justification>".
// Lines starting with "#" are comments; entries without a justification abort
// the run, so an allow-list can never be added silently.
export function parseAllowList(rel) {
  const text = readText(rel);
  const entries = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const separator = line.indexOf("|");
    if (separator === -1) {
      throw new Error(`${rel}:${index + 1}: allow-list entry needs "<regex> | <justification>"`);
    }
    const pattern = line.slice(0, separator).trim();
    const reason = line.slice(separator + 1).trim();
    if (!pattern || !reason) {
      throw new Error(`${rel}:${index + 1}: allow-list entry needs a pattern and a justification`);
    }
    let re;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      throw new Error(`${rel}:${index + 1}: invalid regex: ${err.message}`);
    }
    entries.push({ re, reason, line: index + 1 });
  });
  return entries;
}

export function describeDiff(relA, relB, idA, idB, bufA, bufB) {
  const a = bufA.toString("utf8").split("\n");
  const b = bufB.toString("utf8").split("\n");
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;

  const start = Math.max(0, first - 2);
  const stop = Math.min(first + 2, Math.max(a.length, b.length) - 1);
  const lines = [`${relA}:${first + 1} differs from ${relB}:${first + 1}`];
  for (let i = start; i <= Math.min(stop, a.length - 1); i++) {
    lines.push(`  ${idA.padEnd(7)} ${i + 1}: ${a[i]}`);
  }
  lines.push("  ---");
  for (let i = start; i <= Math.min(stop, b.length - 1); i++) {
    lines.push(`  ${idB.padEnd(7)} ${i + 1}: ${b[i]}`);
  }
  return lines.join("\n");
}
