// Requirement 1: every JavaScript file shipped by both variants must parse.
import vm from "node:vm";
import { VARIANTS } from "../lib/paths.mjs";
import { listFiles, readText } from "../lib/source.mjs";

function syntaxError(rel, err) {
  const stack = String((err && err.stack) || "");
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stack.match(new RegExp(`${escaped}:(\\d+)`));
  return match ? `${rel}:${match[1]}: ${err.message}` : `${rel}: ${err.message}`;
}

export function register(suite) {
  for (const variant of VARIANTS) {
    suite.test(`syntax[${variant.id}]: every JS file parses`, () => {
      const files = listFiles(variant.dir).filter((rel) => rel.endsWith(".js"));
      if (files.length === 0) throw new Error(`${variant.dir}: no JS files found`);

      const failures = [];
      for (const rel of files) {
        try {
          new vm.Script(readText(rel), { filename: rel });
        } catch (err) {
          failures.push(syntaxError(rel, err));
        }
      }
      if (failures.length) {
        throw new Error(`${failures.length}/${files.length} file(s) failed to parse\n${failures.join("\n")}`);
      }
    });
  }
}
