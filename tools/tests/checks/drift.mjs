// Requirement 4: the two packaged variants share 11 JS/HTML/CSS files that must
// stay byte-identical; a divergence means one variant is shipping stale code.
import fs from "node:fs";
import { SHARED_FILES, VARIANTS, VARIANT_ONLY_FILES, abs } from "../lib/paths.mjs";
import { describeDiff, isFile, listFiles } from "../lib/source.mjs";

const [A, B] = VARIANTS;
const PAGE_OR_SOURCE = /\.(?:js|html|css)$/;

function relativeToVariant(variant, file) {
  return file.slice(variant.dir.length + 1);
}

export function register(suite) {
  suite.test(`drift: ${SHARED_FILES.length} shared JS/HTML/CSS files exist in both variants`, () => {
    const problems = [];
    for (const name of SHARED_FILES) {
      for (const variant of VARIANTS) {
        const rel = `${variant.dir}/${name}`;
        if (!isFile(rel)) problems.push(`${rel}: shared file is missing`);
      }
    }
    if (problems.length) throw new Error(problems.join("\n"));
  });

  suite.test("drift: shared files are byte-identical between variants", () => {
    const divergences = [];
    for (const name of SHARED_FILES) {
      const relA = `${A.dir}/${name}`;
      const relB = `${B.dir}/${name}`;
      const bufA = fs.readFileSync(abs(relA));
      const bufB = fs.readFileSync(abs(relB));
      if (!bufA.equals(bufB)) {
        divergences.push(describeDiff(relA, relB, A.id, B.id, bufA, bufB));
      }
    }
    if (divergences.length) throw new Error(divergences.join("\n\n"));
  });

  suite.test("drift: no unexpected variant-only JS/HTML/CSS file", () => {
    const setA = new Set(listFiles(A.dir).filter((rel) => PAGE_OR_SOURCE.test(rel)).map((rel) => relativeToVariant(A, rel)));
    const setB = new Set(listFiles(B.dir).filter((rel) => PAGE_OR_SOURCE.test(rel)).map((rel) => relativeToVariant(B, rel)));
    const problems = [];

    for (const name of setA) {
      if (!setB.has(name) && !VARIANT_ONLY_FILES.has(name)) {
        problems.push(`${A.dir}/${name}: present in ${A.id} but not in ${B.id}`);
      }
    }
    for (const name of setB) {
      if (!setA.has(name) && !VARIANT_ONLY_FILES.has(name)) {
        problems.push(`${B.dir}/${name}: present in ${B.id} but not in ${A.id}`);
      }
    }

    const shared = [...setA].filter((name) => setB.has(name)).sort();
    const expected = [...SHARED_FILES].sort();
    if (shared.join("\n") !== expected.join("\n")) {
      const added = shared.filter((name) => !expected.includes(name));
      const removed = expected.filter((name) => !shared.includes(name));
      if (added.length) {
        problems.push(`shared file set gained: ${added.join(", ")} (add it to SHARED_FILES in tools/tests/lib/paths.mjs)`);
      }
      if (removed.length) {
        problems.push(`shared file set lost: ${removed.join(", ")}`);
      }
    }

    if (problems.length) throw new Error(problems.join("\n"));
  });
}
