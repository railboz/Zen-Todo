// In-memory stand-in for the WebExtension APIs used by the extension sources.
// Enough to load util.js / i18n.js / datepicker.js in a vm sandbox and to unit
// test pure helpers. No network, no browser, no real timers.
import fs from "node:fs";
import vm from "node:vm";
import { abs } from "./lib/paths.mjs";

function createEvent() {
  const listeners = new Set();
  return {
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    hasListener(fn) { return listeners.has(fn); },
    _emit(...args) { return [...listeners].map((fn) => fn(...args)); },
    _listeners: listeners,
  };
}

// chrome.storage semantics: promise when no callback is passed, callback
// otherwise. get(null) returns everything; get({a: 1}) merges defaults.
function createStorageArea() {
  const data = new Map();
  const onChanged = createEvent();

  const selected = (keys) => {
    if (keys == null) return Object.fromEntries(data);
    if (typeof keys === "string") return data.has(keys) ? { [keys]: data.get(keys) } : {};
    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) if (data.has(key)) out[key] = data.get(key);
      return out;
    }
    if (typeof keys === "object") {
      const out = {};
      for (const [key, fallback] of Object.entries(keys)) out[key] = data.has(key) ? data.get(key) : fallback;
      return out;
    }
    return {};
  };

  const settle = (value, callback) => {
    if (typeof callback === "function") {
      callback(value);
      return undefined;
    }
    return Promise.resolve(value);
  };

  return {
    get(keys, callback) { return settle(selected(keys), callback); },
    set(items, callback) {
      const changes = {};
      for (const [key, value] of Object.entries(items || {})) {
        changes[key] = { oldValue: data.get(key), newValue: value };
        data.set(key, value);
      }
      if (Object.keys(changes).length) onChanged._emit(changes, "local");
      return settle(undefined, callback);
    },
    remove(keys, callback) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) data.delete(key);
      return settle(undefined, callback);
    },
    clear(callback) {
      data.clear();
      return settle(undefined, callback);
    },
    onChanged,
    _data: data,
  };
}

export function createFakeChrome() {
  const runtime = {
    onMessage: createEvent(),
    onInstalled: createEvent(),
    onStartup: createEvent(),
    onConnect: createEvent(),
    lastError: undefined,
    async sendMessage() { return undefined; },
    getURL: (p) => `chrome-extension://zen-todo-test/${p}`,
    async getPlatformInfo() { return { os: "linux", arch: "x86-64" }; },
    connect() { return { postMessage() {}, disconnect() {}, onMessage: createEvent() }; },
  };

  const storage = {
    local: createStorageArea(),
    sync: createStorageArea(),
    session: createStorageArea(),
    onChanged: createEvent(),
  };

  return {
    storage,
    runtime,
    alarms: {
      create() {}, clear() {}, get() {}, getAll: async () => [],
      onAlarm: createEvent(),
    },
    tabs: {
      async query() { return []; },
      async sendMessage() { return undefined; },
      async create() { return {}; },
      async update() { return {}; },
      onUpdated: createEvent(),
      onRemoved: createEvent(),
      onActivated: createEvent(),
    },
    notifications: { async create() {}, onClicked: createEvent() },
    contextMenus: { create() {}, removeAll() {}, onClicked: createEvent() },
    commands: { async getAll() { return []; }, onCommand: createEvent() },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {}, onClicked: createEvent() },
    sidePanel: { async open() {}, async setPanelBehavior() {} },
    identity: {
      getRedirectURL: () => "https://test.extensions.allizom.org/",
      async launchWebAuthFlow() { return "https://test.extensions.allizom.org/#access_token=fake"; },
      async getAuthToken() { return { token: "fake" }; },
      async removeCachedAuthToken() {},
    },
  };
}

// Fixed-time Date for deterministic tests (localTodayIso, fireTime, newId).
export function makeFakeDate(fixedMs) {
  return class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }
    static now() { return fixedMs; }
  };
}

export function createSandbox({ now = null, language = "en-US", document = undefined } = {}) {
  const chrome = createFakeChrome();
  const globals = {
    chrome,
    browser: chrome,
    console,
    navigator: { language },
  };
  if (now != null) globals.Date = makeFakeDate(now);
  if (document) globals.document = document;

  const context = vm.createContext(globals);
  const run = (code, filename = "sandbox") => vm.runInContext(code, context, { filename });
  const runJson = (expression) => JSON.parse(run(`JSON.stringify(${expression})`));

  return { chrome, context, run, runJson };
}

// Load the real extension files (never copies) into an existing sandbox.
// Errors raised inside the sandbox then point at extension/<variant>/<file>:line.
export function loadScripts(sandbox, relativeFiles) {
  for (const rel of relativeFiles) {
    sandbox.run(fs.readFileSync(abs(rel), "utf8"), rel);
  }
}

// Minimal DOM used only by the i18n test: records textContent writes and makes
// any use of innerHTML explode, which is exactly the regression we want to catch.
export function makeFakeDocument(selectorMap = {}) {
  const makeElement = (dataset) => {
    const element = {
      dataset,
      textContent: null,
      placeholder: undefined,
      title: undefined,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
    };
    Object.defineProperty(element, "innerHTML", {
      get() { throw new Error("innerHTML must not be used (use textContent)"); },
      set() { throw new Error("innerHTML must not be used (use textContent)"); },
    });
    return element;
  };

  const nodes = {};
  for (const [selector, entries] of Object.entries(selectorMap)) {
    nodes[selector] = entries.map((dataset) => makeElement(dataset));
  }

  const documentElement = { lang: "fr", attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  return {
    elements: nodes,
    document: {
      documentElement,
      querySelectorAll(selector) { return nodes[selector] || []; },
    },
  };
}
