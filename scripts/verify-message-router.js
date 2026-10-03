// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Runtime check of the compiled host against a stale webview.
 *
 * This drives the REAL compiled `DatabaseEditorProvider` through a fake VS Code
 * API, so it exercises the actual message router rather than asserting on
 * source text. It reproduces the reported failure — a webview that sends a
 * diagnostic `log` — against both a current and a stale protocol version, and
 * asserts that neither can produce a fatal error on the webview's load path.
 *
 * Run: node scripts/verify-message-router.js
 */

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

/* ------------------------------ fake vscode ------------------------------ */

const posted = [];
const logs = [];

const fakeVscode = {
  window: {
    registerCustomEditorProvider: () => ({ dispose() {} }),
    createOutputChannel: () => ({
      info: (m) => logs.push(['info', m]),
      warn: (m) => logs.push(['warn', m]),
      error: (m) => logs.push(['error', m]),
      trace: (m) => logs.push(['trace', m]),
      appendLine: (m) => logs.push(['info', m]),
      show: () => undefined,
      dispose: () => undefined
    }),
    showErrorMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    activeTextEditor: undefined,
    tabGroups: { all: [] }
  },
  workspace: {
    onDidChangeConfiguration: () => ({ dispose() {} }),
    getConfiguration: () => ({
      get: (_k, d) => d,
      update: () => Promise.resolve()
    }),
    workspaceFolders: undefined,
    fs: {}
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }), joinPath: () => ({ fsPath: '' }) },
  ConfigurationTarget: { Global: 1 },
  ViewColumn: { Active: -1 },
  EventEmitter: class {
    constructor() {
      this.event = () => ({ dispose() {} });
    }
    fire() {}
    dispose() {}
  },
  l10n: { t: (s) => s },
  env: { language: 'en' }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

/* ----------------------------- the real host ---------------------------- */

const root = path.resolve(__dirname, '..');
const { DatabaseEditorProvider } = require(path.join(root, 'out/extension/DatabaseEditorProvider.js'));
const { PROTOCOL_VERSION } = require(path.join(root, 'out/shared/protocol.js'));

/** Build a provider with a session whose adapter is a no-op stub. */
function makeProvider() {
  const provider = Object.create(DatabaseEditorProvider.prototype);
  const panel = {
    webview: {
      postMessage: (m) => {
        posted.push(m);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: () => ({ dispose() {} }),
      options: {}
    },
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeViewState: () => ({ dispose() {} }),
    active: true,
    dispose: () => undefined
  };
  const adapter = {
    open: async () => ({ driver: 'sqljs', engine: 'sqlite', version: '3.44.0', sizeBytes: 4096, writable: true }),
    getInfo: async () => ({ driver: 'sqljs', engine: 'sqlite', version: '3.44.0', sizeBytes: 4096, writable: true }),
    getObjects: async () => [],
    close: async () => undefined
  };
  provider.sessions = new Map([[panel, { panel, document: { uri: { fsPath: 'x.db' } }, adapter }]]);
  provider.lastActivePanel = panel;
  provider.logger = {
    info: (m) => logs.push(['info', m]),
    warn: (m) => logs.push(['warn', m]),
    error: (m) => logs.push(['error', m]),
    trace: (m) => logs.push(['trace', m])
  };
  provider.state = {
    language: 'en',
    setLanguage: async () => undefined,
    getWebviewSettings: () => ({ language: 'en', pageSize: 50, readOnly: false }),
    applyLanguage: () => undefined,
    notifySettingsChanged: () => undefined
  };
  return { provider, panel };
}

/** Post a message and return every reply the host produced. */
async function exchange(msg) {
  posted.length = 0;
  logs.length = 0;
  const { provider, panel } = makeProvider();
  await provider.handleMessage(msg, panel);
  return { replies: posted.slice(), logs: logs.slice() };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

console.log(`protocol version under test: v${PROTOCOL_VERSION}\n`);

/* The helper is async, so drive the cases through a promise chain. */
(async () => {
  posted.length = 0;
  logs.length = 0;

  const matchedLog = await exchange({
    id: 0,
    type: 'log',
    level: 'error',
    message: 'boom',
    protocolVersion: PROTOCOL_VERSION
  });
  check('a log is never answered with an error', () => {
    assert.equal(
      matchedLog.replies.filter((r) => r.type === 'error').length,
      0,
      'a diagnostics message must never produce an error reply'
    );
  });
  check('a log is mirrored into the Output channel', () => {
    assert.ok(
      matchedLog.logs.some(([lvl, m]) => lvl === 'error' && String(m).includes('[webview] boom')),
      'the diagnostic must reach the Output channel'
    );
  });

  const staleLog = await exchange({
    id: 0,
    type: 'log',
    level: 'info',
    message: 'hello from a new webview',
    protocolVersion: PROTOCOL_VERSION + 1
  });
  check('a log from a mismatched webview is still not an error', () => {
    assert.equal(
      staleLog.replies.filter((r) => r.type === 'error').length,
      0,
      'version skew must not turn a diagnostic into a fatal error'
    );
  });

  const staleRequest = await exchange({
    id: 7,
    type: 'getInfo',
    protocolVersion: PROTOCOL_VERSION + 1
  });
  check('a real request from a mismatched webview gets VERSION_MISMATCH', () => {
    const errs = staleRequest.replies.filter((r) => r.type === 'error');
    assert.equal(errs.length, 1, 'exactly one error reply expected');
    assert.equal(errs[0].error.code, 'VERSION_MISMATCH');
    assert.equal(errs[0].id, 7, 'the reply must carry the request id');
    assert.match(errs[0].error.message, /[Rr]eload the window/);
  });

  const legacyRequest = await exchange({ id: 8, type: 'getInfo' });
  check('a request with no version (older webview) is served normally', () => {
    assert.equal(
      legacyRequest.replies.filter((r) => r.type === 'error').length,
      0,
      'a pre-versioning webview must keep working'
    );
    assert.ok(
      legacyRequest.replies.some((r) => r.type === 'info'),
      'the request must be answered normally'
    );
  });

  const unknownZero = await exchange({ id: 0, type: 'nonsense', protocolVersion: PROTOCOL_VERSION });
  check('an unknown fire-and-forget message is not an error', () => {
    assert.equal(
      unknownZero.replies.filter((r) => r.type === 'error').length,
      0,
      'id 0 cannot be matched to a request, so erroring breaks the UI'
    );
    assert.ok(
      unknownZero.logs.some(([lvl, m]) => lvl === 'warn' && String(m).includes('Unhandled message type')),
      'it must still be recorded in the Output channel'
    );
  });

  const unknownReq = await exchange({ id: 12, type: 'nonsense', protocolVersion: PROTOCOL_VERSION });
  check('an unknown request id is still reported to its caller', () => {
    const errs = unknownReq.replies.filter((r) => r.type === 'error');
    assert.equal(errs.length, 1, 'a real caller must learn its request failed');
    assert.equal(errs[0].id, 12);
  });

  console.log(failures === 0 ? '\nALL ROUTER CHECKS PASSED' : `\n${failures} ROUTER CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
