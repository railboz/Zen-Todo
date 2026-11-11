// Minimal dependency-free test runner: one check = one line, failures carry
// their evidence (file:line) on indented lines, and the process exits 1 on any
// failure. `this is not vitest` is a feature, not an accident.
export function createSuite() {
  const tests = [];

  return {
    test(name, fn) {
      if (typeof name !== "string" || !name.trim()) throw new Error("test name is required");
      if (typeof fn !== "function") throw new Error(`test "${name}" has no function`);
      tests.push({ name, fn });
    },

    async run() {
      let pass = 0;
      let fail = 0;
      console.log("railboz extension test harness - static + unit, no browser, no dependencies");
      console.log("");

      for (const { name, fn } of tests) {
        try {
          await fn();
          pass++;
          console.log(`\u2714 ${name}`);
        } catch (err) {
          fail++;
          console.log(`\u2718 ${name}`);
          const message = err && err.message ? err.message : String(err);
          for (const line of String(message).split("\n")) console.log(`    ${line}`);
        }
      }

      console.log("");
      console.log(`PASS ${pass} / FAIL ${fail}`);
      if (fail > 0) process.exitCode = 1;
      return { pass, fail };
    },
  };
}
