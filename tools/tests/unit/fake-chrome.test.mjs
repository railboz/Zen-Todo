// Self-tests for the test double: if the fake extension API lies, the unit
// tests above it are worthless.
import assert from "node:assert/strict";
import { createFakeChrome } from "../fake-chrome.mjs";

export function register(suite) {
  suite.test("fake-chrome: storage.local is in-memory with get defaults", async () => {
    const chrome = createFakeChrome();
    await chrome.storage.local.set({ a: 1, b: "x" });
    assert.deepEqual(await chrome.storage.local.get(null), { a: 1, b: "x" });
    assert.deepEqual(await chrome.storage.local.get({ a: 0, c: 9 }), { a: 1, c: 9 });
    assert.deepEqual(await chrome.storage.local.get(["a", "missing"]), { a: 1 });
    await chrome.storage.local.remove("a");
    assert.deepEqual(await chrome.storage.local.get(null), { b: "x" });
    await chrome.storage.local.clear();
    assert.deepEqual(await chrome.storage.local.get(null), {});

    await chrome.storage.sync.set({ y: 2 });
    assert.deepEqual(await chrome.storage.local.get(null), {});
    assert.deepEqual(await chrome.storage.sync.get("y"), { y: 2 });
  });

  suite.test("fake-chrome: runtime messaging is a no-op promise", async () => {
    const chrome = createFakeChrome();
    assert.equal(await chrome.runtime.sendMessage({ type: "zt:dirty" }), undefined);
    const listener = () => {};
    chrome.runtime.onMessage.addListener(listener);
    assert.equal(chrome.runtime.onMessage.hasListener(listener), true);
    chrome.runtime.onMessage.removeListener(listener);
    assert.equal(chrome.runtime.onMessage.hasListener(listener), false);
  });
}
