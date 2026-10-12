// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteAdapter } from '../src/extension/adapter/sqliteAdapter';

/**
 * The write lock is taken LAZILY by SQLite: opening a read-write connection on
 * a file another process has locked exclusively SUCCEEDS, and only the first
 * write fails — far too late, with unsaved edits already typed. `open()` now
 * probes the lock with `BEGIN IMMEDIATE` right after opening, and degrades to
 * engine-enforced read-only (`PRAGMA query_only = ON`) when a peer holds it.
 *
 * These tests use a REAL second connection (the same `libsql` driver the
 * adapter uses) as the locking peer, so the lock semantics exercised are the
 * engine's own, not a mock's idea of them.
 */

function tempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-probe-'));
  return path.join(dir, name);
}

/** A raw libsql connection, typed loosely — tests need only exec/all. */
function peer(filePath: string): { exec(sql: string): void; close(): void } {
  // The adapter resolves CJS/default export shapes; under CommonJS tests the
  // module IS the constructor.
  const loaded = require('libsql') as new (p: string, o?: object) => {
    exec(sql: string): void;
    close(): void;
  };
  return new loaded(filePath, { timeout: 250 });
}

describe('exclusive-lock detection at open', () => {
  const created: string[] = [];

  function makeDb(name: string): string {
    const file = tempDbPath(name);
    created.push(file);
    const seed = peer(file);
    seed.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT);');
    seed.exec("INSERT INTO t VALUES (1, 'a');");
    seed.close();
    return file;
  }

  after(() => {
    for (const f of created) {
      try {
        fs.rmSync(path.dirname(f), { recursive: true, force: true });
      } catch {
        // Temp dirs are best-effort cleanup.
      }
    }
  });

  it('stays writable when no peer holds the file', async () => {
    const file = makeDb('free.db');
    const adapter = new SqliteAdapter();
    const info = await adapter.open(file);
    assert.ok(!('code' in info), `open failed: ${JSON.stringify(info)}`);
    assert.equal(info.writable, true, 'an uncontended file must stay writable');
    assert.equal(info.readOnly, false);
    assert.equal(info.readOnlyReason, undefined);
    adapter.close();
  });

  it('detects a peer write transaction and opens read-only', async () => {
    const file = makeDb('locked.db');
    // The peer takes the write path and KEEPS it: BEGIN IMMEDIATE on the
    // adapter's probe must now collide.
    const holding = peer(file);
    holding.exec('BEGIN IMMEDIATE;');
    holding.exec("INSERT INTO t VALUES (2, 'b');");

    const adapter = new SqliteAdapter();
    const info = await adapter.open(file);
    assert.ok(!('code' in info), `open failed: ${JSON.stringify(info)}`);
    assert.equal(info.readOnly, true, 'a peer-locked file must be reported read-only');
    assert.equal(info.readOnlyReason, 'locked', 'the reason must be the lock, not the user setting');
    assert.equal(info.writable, false);

    // The degradation is ENGINE-enforced, not cosmetic: writes are refused by
    // the connection itself (query_only), and reads still work. The peer's
    // INSERT above is uncommitted, so only the seeded row is visible — which is
    // itself the correct MVCC answer.
    const read = await adapter.query('SELECT * FROM t', 0, 100);
    assert.ok(!('code' in read), `read failed: ${JSON.stringify(read)}`);
    assert.equal(read.rows.length, 1, 'reads must keep working (committed rows only)');
    adapter.close();

    holding.exec('ROLLBACK;');
    holding.close();
  });

  it('becomes writable again once the peer releases the lock', async () => {
    const file = makeDb('released.db');
    const holding = peer(file);
    holding.exec('BEGIN EXCLUSIVE;');

    const locked = new SqliteAdapter();
    const lockedInfo = await locked.open(file);
    assert.ok(!('code' in lockedInfo));
    assert.equal(lockedInfo.readOnlyReason, 'locked', 'the probe must catch an EXCLUSIVE holder');
    locked.close();

    holding.exec('ROLLBACK;');
    holding.close();

    const after = new SqliteAdapter();
    const info = await after.open(file);
    assert.ok(!('code' in info));
    assert.equal(info.readOnly, false, 'after release a fresh open must be writable');
    assert.equal(info.readOnlyReason, undefined);
    after.close();
  });

  it('never reports locked when the user asked for read-only', async () => {
    const file = makeDb('user-ro.db');
    const adapter = new SqliteAdapter();
    const info = await adapter.open(file, { readOnly: true });
    assert.ok(!('code' in info));
    assert.equal(info.readOnly, true);
    assert.equal(info.readOnlyReason, 'user', 'the user setting must win the reason attribution');
    adapter.close();
  });
});
