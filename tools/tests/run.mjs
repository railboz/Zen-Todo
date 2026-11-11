#!/usr/bin/env node
// Entry point: `node tools/tests/run.mjs` from the repo/worktree root.
// Static + unit checks only: no browser, no network, no npm dependencies.
import { createSuite } from "./lib/suite.mjs";
import * as syntaxChecks from "./checks/syntax.mjs";
import * as securityChecks from "./checks/security.mjs";
import * as manifestChecks from "./checks/manifest.mjs";
import * as manifestContractChecks from "./checks/manifest-contract.mjs";
import * as driftChecks from "./checks/drift.mjs";
import * as utilTests from "./unit/util.test.mjs";
import * as i18nTests from "./unit/i18n.test.mjs";
import * as datepickerTests from "./unit/datepicker.test.mjs";
import * as fakeChromeTests from "./unit/fake-chrome.test.mjs";

const suite = createSuite();

syntaxChecks.register(suite);
securityChecks.register(suite);
manifestChecks.register(suite);
manifestContractChecks.register(suite);
driftChecks.register(suite);
utilTests.register(suite);
i18nTests.register(suite);
datepickerTests.register(suite);
fakeChromeTests.register(suite);

await suite.run();
