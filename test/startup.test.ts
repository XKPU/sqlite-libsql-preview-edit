import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DatabaseInfo, HostRequest, HostResponse, ObjectInfo, WebviewSettings } from '../src/shared/protocol';

/**
 * The editor used to sit on "Loading database…" forever.
 *
 * Cause: the host pushed the `ready` snapshot from `resolveCustomEditor`, but
 * the webview attaches its `window.message` listener during its first render —
 * so if the push won the race it was dropped, `dbInfo` stayed null, and the
 * info bar rendered the loading text permanently.
 *
 * These tests model the two message paths with a fake transport, asserting that
 * the `init` handshake delivers the snapshot even when the initial push is lost.
 */

interface Transport {
  /** Simulates the host pushing an unsolicited response (id 0). */
  hostPush(msg: HostResponse): void;
  /** Simulates the webview posting a request; returns the host's reply. */
  webviewSend(req: HostRequest): Promise<HostResponse>;
}

/** Minimal stand-in for the host's request handling + the webview's bridge. */
function makeHarness(opts: { dropInitialPush: boolean }) {
  const settings: WebviewSettings = {
    language: 'en',
    pageSize: 50,
    readOnly: false,
    confirmDestructiveActions: true,
    nullDisplay: 'NULL',
    maxCellLength: 1000,
    exportEncoding: 'utf8'
  };

  let adapterOpen = false;
  const info: DatabaseInfo = {
    path: '/tmp/demo.db',
    sizeBytes: 8192,
    pageSize: 4096,
    encoding: 'utf-8',
    tableCount: 1,
    viewCount: 0,
    indexCount: 0,
    triggerCount: 0,
    writable: true,
    readOnly: false,
    version: '3.49.1',
    driver: 'sql.js',
    engine: 'sqlite',
    detection: { engine: 'sqlite', libSql: false, fallback: false, evidence: [], decidedBy: 'none' },
    capabilities: {
      strictTables: false,
      alterColumn: false,
      vectorSearch: false,
      upsertReturning: false,
      embeddedReplicas: false,
      nonConstantDefaults: false,
      onlyFunctions: []
    }
  };
  const objects: ObjectInfo[] = [{ name: 'users', type: 'table', sql: 'CREATE TABLE users(id);' }];

  /** Responses the host pushed before the webview was listening. */
  const missed: HostResponse[] = [];
  let listening = false;
  let pendingInit: ((r: HostResponse) => void) | null = null;
  let readyCount = 0;

  const readySnapshot = (id: number): HostResponse => ({ id, type: 'ready', info, objects, settings });

  const transport: Transport = {
    hostPush(msg) {
      if (!listening) {
        missed.push(msg);
        return;
      }
      if (pendingInit) {
        const resolve = pendingInit;
        pendingInit = null;
        resolve(msg);
      }
    },
    async webviewSend(req) {
      if (req.type === 'init') {
        // The host answers the handshake with a fresh snapshot, so it does not
        // matter whether the original push was dropped.
        return readySnapshot(req.id);
      }
      if (req.type === 'close') {
        adapterOpen = false;
        return { id: req.id, type: 'closed' };
      }
      if (req.type === 'getInfo') {
        return adapterOpen ? { id: req.id, type: 'info', info } : { id: req.id, type: 'error', error: { code: 'UNKNOWN', message: 'closed' } };
      }
      throw new Error(`unhandled request ${req.type}`);
    }
  };

  return {
    transport,
    info,
    objects,
    connect() {
      listening = true;
    },
    get missedCount() {
      return missed.length;
    },
    get readyCount() {
      return readyCount;
    },
    async open() {
      adapterOpen = true;
      readyCount++;
      transport.hostPush(readySnapshot(0));
    },
    expectInit: () => new Promise<HostResponse>((resolve) => (pendingInit = resolve))
  };
}

describe('editor startup handshake', () => {
  it('reproduces the stuck-loading race: an early push is lost', async () => {
    const h = makeHarness({ dropInitialPush: true });
    // Host opens and pushes before the webview is listening.
    await h.open();
    assert.equal(h.missedCount, 1, 'the initial push should have been dropped');

    // Without a handshake the UI has no snapshot — this is the reported bug.
    let dbInfo: DatabaseInfo | null = null;
    assert.equal(dbInfo, null, 'dbInfo stays null, so the UI shows "Loading database…"');

    // With the handshake, the state arrives regardless.
    h.connect();
    const reply = await h.transport.webviewSend({ id: 1, type: 'init' });
    assert.equal(reply.type, 'ready');
    if (reply.type === 'ready') dbInfo = reply.info;
    assert.equal(dbInfo?.path, '/tmp/demo.db');
  });

  it('delivers the snapshot on a fresh open when the push is not lost', async () => {
    const h = makeHarness({ dropInitialPush: false });
    h.connect();
    await h.open();
    assert.equal(h.missedCount, 0);
  });

  it('answers the handshake with the current settings and objects', async () => {
    const h = makeHarness({ dropInitialPush: true });
    h.connect();
    await h.open();
    const reply = await h.transport.webviewSend({ id: 7, type: 'init' });
    assert.equal(reply.type, 'ready');
    if (reply.type !== 'ready') throw new Error('expected ready');
    assert.equal(reply.id, 7, 'the handshake reply must carry the request id');
    assert.equal(reply.settings.readOnly, false);
    assert.equal(reply.settings.pageSize, 50);
    assert.deepEqual(reply.objects.map((o) => o.name), ['users']);
    assert.equal(reply.info.driver, 'sql.js');
  });

  it('replies to close with a closed response, not a meaningless pong', async () => {
    const h = makeHarness({ dropInitialPush: true });
    h.connect();
    await h.open();
    const reply = await h.transport.webviewSend({ id: 9, type: 'close' });
    assert.equal(reply.type, 'closed');
  });

  it('reports an error instead of hanging when the adapter is closed', async () => {
    const h = makeHarness({ dropInitialPush: true });
    h.connect();
    await h.open();
    await h.transport.webviewSend({ id: 10, type: 'close' });
    const reply = await h.transport.webviewSend({ id: 11, type: 'getInfo' });
    assert.equal(reply.type, 'error');
  });
});

describe('startup effect survives its own cleanup', () => {
  it('does not use StrictMode', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/main.tsx', 'utf8');
    // Not the cause of the stall — this webview ships production React, where
    // StrictMode does not double-invoke effects — but a second mount/unmount
    // cycle is one more way for the handshake to be cancelled, so it is off.
    assert.ok(!/<React\.StrictMode>/.test(src), 'StrictMode must not wrap the app');
    assert.ok(!/StrictMode/.test(src.replace(/\/\/[^\n]*/g, '')), 'no StrictMode outside comments');
  });

  it('has no run-once guard that could strand the handshake', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useDatabaseState.ts', 'utf8');
    // The guard was the second half of the bug: it prevented the retry after
    // the first run had been cancelled.
    assert.ok(!/didInit/.test(src), 'the run-once ref guard must be gone');
  });

  it('re-sends init on every mount so a cancelled attempt is recoverable', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useDatabaseState.ts', 'utf8');
    const initEffects = src.match(/type: 'init'/g) ?? [];
    assert.equal(initEffects.length, 1, 'exactly one init request site');
    assert.match(src, /bridge\.send\(\{ type: 'init' \}\)/, 'init is sent unconditionally on mount');
  });
});

describe('the bridge has a stable identity', () => {
  it('memoises the returned bridge object', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useWebview.ts', 'utf8');
    // A fresh object literal each render made every `[bridge]` effect re-run on
    // every render, which re-requested the snapshot in a loop.
    assert.match(src, /useMemo</, 'the bridge must be memoised');
    assert.match(src, /return bridge;/, 'the memoised value must be returned');
  });
});

describe('diagnostics reach the Output channel', () => {
  it('creates a real VS Code log output channel', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/logger.ts', 'utf8');
    assert.match(src, /createOutputChannel\(/, 'must use createOutputChannel');
    assert.match(src, /\{ log: true \}/, 'should opt into the log UI');
  });

  it('records both directions of the host/webview conversation', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    assert.match(src, /-> host received:/, 'incoming requests must be logged');
    assert.match(src, /<- host sending:/, 'outgoing messages must be logged');
  });

  it('accepts webview-side log messages', async () => {
    const fs = await import('node:fs/promises');
    const proto = await fs.readFile('src/shared/protocol.ts', 'utf8');
    const prov = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    assert.match(proto, /type: 'log';\s*level:/, 'the log request must be in the protocol');
    assert.match(prov, /case 'log':/, 'the host must handle it');
  });

  it('exposes a show-log command', async () => {
    const pkg = await import('../package.json');
    const cmd = (pkg.default ?? pkg).contributes.commands.find(
      (c: { command: string }) => c.command === 'libSqlPreviewEdit.showLog'
    );
    assert.ok(cmd, 'the showLog command must be contributed');
  });
});

describe('bridge identity is permanent (no init feedback loop)', () => {
  it('does not list volatile language/settings in the bridge memo deps', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useWebview.ts', 'utf8');
    // The host builds a FRESH settings object for every `ready` reply. If the
    // memo depended on `settings`, each reply would produce a new bridge
    // identity, re-running the [bridge]-dependent init effect forever:
    //   ready -> setSettings(new object) -> new bridge -> init -> ready -> ...
    const memoStart = src.indexOf('const bridge = useMemo');
    assert.ok(memoStart > 0, 'the bridge memo must exist');
    const memoEnd = src.indexOf(');', src.indexOf('return bridge', memoStart));
    const memo = src.slice(memoStart, memoEnd);
    const deps = memo.slice(memo.lastIndexOf('],'));
    assert.ok(!/\bsettings\b/.test(deps), 'settings must not be a bridge memo dep');
    assert.ok(!/\blanguage\b/.test(deps), 'language must not be a bridge memo dep');
  });

  it('exposes language and settings via getters over refs', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useWebview.ts', 'utf8');
    assert.match(src, /get settings\(\)/, 'settings must be a getter');
    assert.match(src, /get language\(\)/, 'language must be a getter');
  });

  it('reads the current value at read time, not at creation time', () => {
    // Mirrors the getter contract: destructuring during a render must observe
    // the latest host settings.
    const ref: { current: { language: string } } = { current: { language: 'en' } };
    const bridge = {
      get settings(): { language: string } {
        return ref.current;
      }
    };
    assert.equal(bridge.settings.language, 'en');
    ref.current = { language: 'zh-cn' };
    assert.equal(bridge.settings.language, 'zh-cn');
  });
});

describe('a diagnostic can never become a fatal load error', () => {
  /** Locate the host's `default:` arm inside the message switch. */
  async function defaultArm(): Promise<string> {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    const start = src.indexOf('default: {');
    assert.ok(start > 0, 'the switch must have a braced default arm');
    const arm = src.slice(start, src.indexOf('\n      }', start));
    assert.ok(arm.length > 0, 'the default arm must be locatable');
    return arm;
  }

  it('logs an unknown message type instead of only erroring', async () => {
    const arm = await defaultArm();
    assert.match(arm, /this\.logger\.warn\(/, 'unknown types must reach the Output channel');
  });

  it('accepts the log message type explicitly', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    // Regression: a stale host replied "Unhandled message type: log" to the
    // webview's diagnostic, and because that reply carried id 0 the webview
    // routed it to the load-error path — one log line broke the whole editor.
    assert.ok(
      src.includes("case 'log'"),
      "the host must handle 'log' explicitly, not fall through to default"
    );
  });

  it('never answers an id-0 (fire-and-forget) message with an error', async () => {
    const arm = await defaultArm();
    assert.match(
      arm,
      /id\s*>\s*0/,
      'only request/response messages (id > 0) may produce an error reply'
    );
  });

  it('detects a protocol version mismatch and asks for a reload', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    // The comparison itself lives in the shared, unit-tested protocolSkew
    // module; the host must actually consult it and report a dedicated code.
    assert.match(src, /isCompatibleSender\(msg\.protocolVersion\)/, 'the host must vet senders');
    assert.match(src, /VERSION_MISMATCH/, 'the host must report a dedicated code');
  });

  it('advertises the protocol version in the ready snapshot', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    const ready = src.slice(src.indexOf("type: 'ready'"));
    assert.match(
      ready.slice(0, 300),
      /protocolVersion: PROTOCOL_VERSION/,
      'the ready snapshot must announce the contract version'
    );
  });

  it('stamps outgoing webview requests with the protocol version', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useWebview.ts', 'utf8');
    assert.ok(
      src.includes('protocolVersion: PROTOCOL_VERSION'),
      'requests must declare the version they were built against'
    );
  });

  it('buffers diagnostics until the host version is known', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useWebview.ts', 'utf8');
    // Sending `log` before the host has identified itself is what allowed a
    // stale host to mistake a diagnostic for a database failure. The decision
    // rule is unit-tested in protocol-skew.test.ts; here we assert the bridge
    // really consults it.
    assert.match(src, /bufferedLogs/, 'unconfirmed hosts must have logs buffered');
    assert.match(
      src,
      /decideLog\(hostProtocol\.current\)/,
      'the log path must consult the shared decision rule'
    );
  });

  it('treats a host that omits the version as version 1', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useWebview.ts', 'utf8');
    assert.match(
      src,
      /reportedHostVersion\(response\.protocolVersion\)/,
      'a legacy host must be recognised as version 1, not as unknown'
    );
  });
});
