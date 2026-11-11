// Requirement 3: unit tests of util.js loaded from the real extension files in
// a vm sandbox. Helpers use fixed dates, never the network or a real clock.
import assert from "node:assert/strict";
import { VARIANTS } from "../lib/paths.mjs";
import { createSandbox, loadScripts } from "../fake-chrome.mjs";

function boot(variant, options = {}) {
  const sandbox = createSandbox(options);
  loadScripts(sandbox, [`${variant.dir}/util.js`]);
  return sandbox;
}

export function register(suite) {
  for (const variant of VARIANTS) {
    const tag = `[${variant.id}]`;

    suite.test(`util${tag}: validIso accepts real calendar dates only`, () => {
      const s = boot(variant);
      assert.equal(s.run('validIso("2024-02-29")'), true);
      assert.equal(s.run('validIso("2026-12-31")'), true);
      assert.equal(s.run('validIso("2023-02-29")'), false);
      assert.equal(s.run('validIso("2024-13-01")'), false);
      assert.equal(s.run('validIso("2024-00-10")'), false);
      assert.equal(s.run('validIso("2024-2-09")'), false);
      assert.equal(s.run("validIso(20240101)"), false);
      assert.equal(s.run("validIso(null)"), false);
    });

    suite.test(`util${tag}: cleanText strips control/bidi chars and caps length`, () => {
      const s = boot(variant);
      const dirty = "a\u0000b\u000bc\u202ed\ufeff";
      assert.equal(s.run(`cleanText(${JSON.stringify(dirty)}, 10)`), "abcd");
      assert.equal(s.run('cleanText("abcdef", 3)'), "abc");
      assert.equal(s.run('cleanText("abcdef", 100)'), "abcdef");
      assert.equal(s.run("cleanText(null, 10)"), "");
      assert.equal(s.run("cleanText(undefined, 10)"), "");
    });

    suite.test(`util${tag}: safeId rejects invalid and prototype-reserved ids`, () => {
      const s = boot(variant);
      assert.equal(s.run('safeId("abc-123_X")'), "abc-123_X");
      assert.equal(s.run('safeId("__proto__")'), null);
      assert.equal(s.run('safeId("toString")'), null);
      assert.equal(s.run('safeId("constructor")'), null);
      assert.equal(s.run('safeId("has space")'), null);
      assert.equal(s.run("safeId(42)"), null);
      assert.equal(s.run(`safeId("${"a".repeat(40)}")`), "a".repeat(40));
      assert.equal(s.run(`safeId("${"a".repeat(41)}")`), null);
    });

    suite.test(`util${tag}: stableId is deterministic and content-sensitive`, () => {
      const s = boot(variant);
      const first = s.run('stableId("x", "hello")');
      assert.match(first, /^x[0-9a-z]+$/);
      assert.equal(s.run('stableId("x", "hello")'), first);
      assert.notEqual(s.run('stableId("x", "hellp")'), first);
      assert.equal(s.run('stableId("p", null)'), s.run('stableId("p", "")'));
    });

    suite.test(`util${tag}: uniqueIds renames duplicates without reordering`, () => {
      const s = boot(variant);
      const expr = 'uniqueIds([{id:"a",text:"x"},{id:"a",text:"y"},{id:"b",text:"z"}], "s")';
      const out = s.runJson(expr);
      assert.deepEqual(out.map((item) => item.text), ["x", "y", "z"]);
      // Every entry of a duplicated group gets a new id derived from its full
      // content (see the comment above uniqueIds), so the two "a" tasks stay
      // distinct; the unique "b" task keeps its id.
      assert.notEqual(out[0].id, "a");
      assert.notEqual(out[1].id, "a");
      assert.notEqual(out[0].id, out[1].id);
      assert.match(out[0].id, /^s[0-9a-z]+$/);
      assert.match(out[1].id, /^s[0-9a-z]+$/);
      assert.equal(out[2].id, "b");
      assert.deepEqual(s.runJson(expr), out);
    });

    suite.test(`util${tag}: sanitizeTask keeps a valid task and drops unknown fields`, () => {
      const s = boot(variant);
      const input = {
        id: "abc",
        text: "  Buy milk  ",
        priority: "high",
        repeat: "weekly",
        due: "2026-03-10",
        time: "14:30",
        remind: 10,
        done: true,
        note: "memo",
        updatedAt: 1234.9,
        injected: "x",
      };
      const task = s.runJson(`sanitizeTask(${JSON.stringify(input)})`);
      assert.equal(task.id, "abc");
      assert.equal(task.text, "Buy milk");
      assert.equal(task.priority, "high");
      assert.equal(task.repeat, "weekly");
      assert.equal(task.due, "2026-03-10");
      assert.equal(task.time, "14:30");
      assert.equal(task.remind, "10");
      assert.equal(task.done, true);
      assert.equal(task.note, "memo");
      assert.equal(task.updatedAt, 1234);
      assert.equal("injected" in task, false);
    });

    suite.test(`util${tag}: sanitizeTask normalizes or rejects corrupt input`, () => {
      const s = boot(variant);
      assert.equal(s.run("sanitizeTask(null)"), null);
      assert.equal(s.run("sanitizeTask({})"), null);
      assert.equal(s.run('sanitizeTask({text:"   "})'), null);

      const bad = s.runJson(`sanitizeTask(${JSON.stringify({
        text: "x",
        priority: "urgent",
        repeat: "yearly",
        due: "2026-02-30",
        time: "25:00",
        remind: "oops",
        done: "true",
        note: "n".repeat(600),
        repeatDay: 31,
      })})`);
      assert.equal(bad.priority, "medium");
      assert.equal(bad.repeat, "none");
      assert.equal(bad.due, null);
      assert.equal(bad.time, "09:00");
      assert.equal(bad.remind, "none");
      assert.equal(bad.done, false);
      assert.equal(bad.note.length, 500);
      assert.equal("repeatDay" in bad, false);
      assert.equal("updatedAt" in bad, false);

      const longText = s.runJson(`sanitizeTask(${JSON.stringify({ text: "a".repeat(300) })})`);
      assert.equal(longText.text.length, 200);

      const monthly = s.runJson('sanitizeTask({text:"x", repeat:"monthly", repeatDay:31})');
      assert.equal(monthly.repeatDay, 31);
      const daily = s.runJson('sanitizeTask({text:"x", repeat:"daily", repeatDay:5})');
      assert.equal("repeatDay" in daily, false);
      const overflow = s.runJson('sanitizeTask({text:"x", repeat:"monthly", repeatDay:32})');
      assert.equal("repeatDay" in overflow, false);

      const proto = s.runJson('sanitizeTask({text:"x", id:"__proto__"})');
      assert.match(proto.id, /^x[0-9a-z]+$/);
      assert.equal(s.runJson('sanitizeTask({text:"x", id:"__proto__"})').id, proto.id);
    });

    suite.test(`util${tag}: fireTime computes reminder time and rejects invalid input`, () => {
      const s = boot(variant);
      const expected = new Date(2026, 2, 10, 14, 30).getTime() - 10 * 60000;
      assert.equal(
        s.run(`fireTime(${JSON.stringify({ due: "2026-03-10", time: "14:30", remind: "10" })})`),
        expected,
      );

      const defaultTime = new Date(2026, 2, 10, 9, 0).getTime() - 60 * 60000;
      assert.equal(
        s.run(`fireTime(${JSON.stringify({ due: "2026-03-10", remind: "60" })})`),
        defaultTime,
      );

      assert.equal(s.run('fireTime({due:"2026-03-10",remind:"none"})'), null);
      assert.equal(s.run('fireTime({due:"2026-03-10",time:"24:00",remind:"10"})'), null);
      assert.equal(s.run('fireTime({due:"2026-02-30",remind:"10"})'), null);
      assert.equal(s.run('fireTime({due:"2026-03-10",remind:"oops"})'), null);
      assert.equal(s.run("fireTime({})"), null);
    });

    suite.test(`util${tag}: localTodayIso uses the local date and newId has a stable shape`, () => {
      const fixed = new Date(2026, 2, 8, 23, 30).getTime();
      const s = boot(variant, { now: fixed });
      assert.equal(s.run("localTodayIso()"), "2026-03-08");
      assert.match(s.run("newId()"), /^[0-9a-z]{4,20}$/);
    });

    suite.test(`util${tag}: sanitizeProject keeps valid projects and sanitizes subs`, () => {
      const s = boot(variant);
      const input = {
        id: "p1",
        name: "  Work  ",
        color: "#AABBCC",
        open: true,
        due: "2026-03-10",
        time: "08:05",
        remind: "60",
        subs: [{ id: "s1", text: " a ", done: true }, { text: "b" }, { text: "   " }],
        injected: 1,
      };
      const project = s.runJson(`sanitizeProject(${JSON.stringify(input)})`);
      assert.equal(project.id, "p1");
      assert.equal(project.name, "Work");
      assert.equal(project.color, "#AABBCC");
      assert.equal(project.open, true);
      assert.equal(project.due, "2026-03-10");
      assert.equal(project.time, "08:05");
      assert.equal(project.remind, "60");
      assert.equal(project.subs.length, 2);
      assert.deepEqual(project.subs[0], { id: "s1", text: "a", done: true });
      assert.match(project.subs[1].id, /^s[0-9a-z]+$/);
      assert.equal(project.subs[1].text, "b");
      assert.equal(project.subs[1].done, false);
      assert.equal("injected" in project, false);
    });

    suite.test(`util${tag}: sanitizeProject falls back on corrupt values`, () => {
      const s = boot(variant);
      assert.equal(s.run("sanitizeProject(null)"), null);
      assert.equal(s.run('sanitizeProject({name:"   "})'), null);

      const bad = s.runJson(`sanitizeProject(${JSON.stringify({
        name: "p",
        color: "red",
        due: "2026-02-30",
        time: "99:99",
        remind: 5,
        subs: "nope",
      })})`);
      assert.equal(bad.color, "#7c5cff");
      assert.equal(bad.due, null);
      assert.equal(bad.time, "09:00");
      assert.equal(bad.remind, "none");
      assert.deepEqual(bad.subs, []);

      const protoSub = s.runJson('sanitizeProject({name:"p", subs:[{id:"__proto__", text:"x"}]})');
      assert.match(protoSub.subs[0].id, /^s[0-9a-z]+$/);
    });
  }
}
