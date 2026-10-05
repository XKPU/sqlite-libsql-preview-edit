// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  detectLibSqlInExtension,
  detectLibSqlInHeader,
  detectLibSqlInPragma,
  detectLibSqlInSchema,
  detectLibSqlInVersion,
  extensionOf,
  hasLibSqlExtension,
  hasSqliteExtension,
  hasSqliteHeader,
  LIBSQL_CAPABILITIES,
  resolveLibSqlDetection,
  SQLITE_CAPABILITIES,
  SQLITE_HEADER_FIXED_BYTES,
  SQLITE_HEADER_MAGIC
} from '../src/shared/protocol';

/** Build a SQLite header page with the given bytes written at 21..23. */
function header(fixed: readonly number[] = SQLITE_HEADER_FIXED_BYTES): Uint8Array {
  const buf = new Uint8Array(100);
  for (let i = 0; i < SQLITE_HEADER_MAGIC.length; i++) {
    buf[i] = SQLITE_HEADER_MAGIC.charCodeAt(i);
  }
  buf[21] = fixed[0] ?? 0;
  buf[22] = fixed[1] ?? 0;
  buf[23] = fixed[2] ?? 0;
  return buf;
}

describe('extensionOf', () => {
  it('returns the lower-cased extension', () => {
    assert.equal(extensionOf('/tmp/a/B.CSV'), '.csv');
    assert.equal(extensionOf('C:\\data\\x.libsql'), '.libsql');
  });

  it('returns an empty string when there is no extension', () => {
    assert.equal(extensionOf('/tmp/README'), '');
    assert.equal(extensionOf('/tmp/.hidden'), '');
  });
});

describe('extension classification', () => {
  it('recognises the LibSQL-only extension', () => {
    assert.equal(hasLibSqlExtension('/tmp/a.libsql'), true);
    assert.equal(hasLibSqlExtension('/tmp/a.LIBSQL'), true);
    assert.equal(hasLibSqlExtension('/tmp/a.sqlite'), false);
  });

  it('recognises the plain SQLite extensions', () => {
    assert.equal(hasSqliteExtension('/tmp/a.db'), true);
    assert.equal(hasSqliteExtension('/tmp/a.sqlite3'), true);
    assert.equal(hasSqliteExtension('/tmp/a.libsql'), false);
  });
});

describe('detectLibSqlInHeader', () => {
  /**
   * A SQLite database is byte-compatible with LibSQL, and bytes 21..23 are
   * fixed constants (64, 32, 32) in every header SQLite will open. Verified
   * empirically: stamping anything else there makes SQLite reject the file with
   * "file is not a database". So the header can never prove the dialect, and
   * these tests pin that down rather than asserting a marker that cannot exist.
   */
  it('reports no evidence for a well-formed SQLite header', () => {
    assert.deepEqual(detectLibSqlInHeader(header()), []);
  });

  it('reports no evidence even when bytes 21-23 are abnormal', () => {
    // Such a file is not openable by SQLite, so it is not LibSQL evidence.
    assert.deepEqual(detectLibSqlInHeader(header([76, 66, 83])), []);
  });

  it('reports nothing for a non-SQLite file', () => {
    const buf = new Uint8Array(100);
    buf[0] = 0x50; // 'P'
    assert.deepEqual(detectLibSqlInHeader(buf), []);
  });

  it('never throws on a file that is too short', () => {
    assert.deepEqual(detectLibSqlInHeader(new Uint8Array(4)), []);
    assert.deepEqual(detectLibSqlInHeader(undefined), []);
  });

  it('validates the SQLite magic independently of detection', () => {
    assert.equal(hasSqliteHeader(header()), true);
    assert.equal(hasSqliteHeader(new Uint8Array(4)), false);
    assert.equal(hasSqliteHeader(undefined), false);
  });
});

describe('detectLibSqlInVersion', () => {
  it('matches a LibSQL version suffix', () => {
    const ev = detectLibSqlInVersion('3.45.1-libsql');
    assert.equal(ev[0]?.kind, 'version');
  });

  it('matches sqld', () => {
    assert.equal(detectLibSqlInVersion('sqld 0.24').length, 1);
  });

  it('ignores a stock SQLite version', () => {
    assert.deepEqual(detectLibSqlInVersion('3.45.1'), []);
    assert.deepEqual(detectLibSqlInVersion(undefined), []);
  });
});

describe('detectLibSqlInPragma and detectLibSqlInSchema', () => {
  it('finds a LibSQL compile option', () => {
    const ev = detectLibSqlInPragma(['MAX_VARIABLE_NUMBER=32766', 'LIBSQL_BUILD=1']);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]?.kind, 'pragma');
  });

  it('finds a libsql_* system table', () => {
    const ev = detectLibSqlInSchema(['users', 'libsql_wal']);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]?.kind, 'schema');
  });

  it('ignores ordinary schema names', () => {
    assert.deepEqual(detectLibSqlInSchema(['users', 'orders']), []);
    assert.deepEqual(detectLibSqlInPragma(['ENABLE_FTS5']), []);
  });
});

describe('detectLibSqlInExtension', () => {
  it('produces evidence for a .libsql file only', () => {
    assert.equal(detectLibSqlInExtension('/tmp/a.libsql').length, 1);
    assert.deepEqual(detectLibSqlInExtension('/tmp/a.sqlite'), []);
  });
});

describe('resolveLibSqlDetection', () => {
  it('defaults to the SQLite baseline when there is no evidence', () => {
    const d = resolveLibSqlDetection('/tmp/a.sqlite', {}, true);
    assert.equal(d.engine, 'sqlite');
    assert.equal(d.libSql, false);
    assert.equal(d.fallback, false);
    assert.equal(d.decidedBy, 'none');
    assert.deepEqual(d.evidence, []);
  });

  it('detects LibSQL from the version string even when named .sqlite', () => {
    const d = resolveLibSqlDetection('/tmp/renamed.sqlite', { version: '3.45.1-libsql' }, true);
    assert.equal(d.engine, 'libsql');
    assert.equal(d.libSql, true);
    assert.equal(d.decidedBy, 'version');
    assert.equal(d.fallback, true);
  });

  it('detects LibSQL from the extension alone', () => {
    const d = resolveLibSqlDetection('/tmp/a.libsql', {}, true);
    assert.equal(d.libSql, true);
    assert.equal(d.decidedBy, 'extension');
  });

  it('lets the strongest single signal decide, without summing', () => {
    const d = resolveLibSqlDetection(
      '/tmp/a.libsql',
      { version: '3.45.1-libsql', objectNames: ['libsql_wal'] },
      true
    );
    // Version (80) outranks schema (75) and extension (60).
    assert.equal(d.decidedBy, 'version');
    assert.equal(d.evidence.length, 3);
    assert.deepEqual(
      d.evidence.map((e) => e.kind),
      ['version', 'schema', 'extension']
    );
  });

  it('never mislabels a plain SQLite file, however it is probed', () => {
    // The strongest realistic false-positive attempt: a renamed plain SQLite
    // database whose header is inspected and whose schema is ordinary.
    const d = resolveLibSqlDetection(
      '/tmp/plain.sqlite',
      { header: header(), objectNames: ['users', 'orders'], version: '3.49.1' },
      true
    );
    assert.equal(d.engine, 'sqlite');
    assert.equal(d.libSql, false);
    assert.equal(d.decidedBy, 'none');
    assert.deepEqual(d.evidence, []);
  });
});

describe('capability sets', () => {
  it('leaves every LibSQL capability off in the SQLite baseline', () => {
    for (const value of Object.values(SQLITE_CAPABILITIES)) {
      if (Array.isArray(value)) {
        assert.equal(value.length, 0);
      } else {
        assert.equal(value, false);
      }
    }
  });

  it('turns every LibSQL capability on once detected', () => {
    assert.equal(LIBSQL_CAPABILITIES.strictTables, true);
    assert.equal(LIBSQL_CAPABILITIES.alterColumn, true);
    assert.equal(LIBSQL_CAPABILITIES.vectorSearch, true);
    assert.equal(LIBSQL_CAPABILITIES.upsertReturning, true);
    assert.equal(LIBSQL_CAPABILITIES.embeddedReplicas, true);
    assert.equal(LIBSQL_CAPABILITIES.nonConstantDefaults, true);
    assert.ok(LIBSQL_CAPABILITIES.onlyFunctions.includes('vector_distance_cos'));
  });
});

describe('SQLite header fixed bytes (empirical)', () => {
  /**
   * These assertions document *why* header-based LibSQL detection was removed.
   * SQLite validates bytes 21..23 of the header as its payload-fraction
   * constants, so a file with anything else there is rejected outright — meaning
   * no LibSQL marker can live there in a file that opens.
   *
   * The runtime proof of that (writing a real database and stamping an "LBS"
   * marker into byte 21) used to run against the removed WASM adapter; it is
   * covered end-to-end by `scripts/verify-vsix.js`, which drives the native
   * LibSQL adapter through the same header and corruption checks.
   */
  it('pins the payload-fraction constants the header must carry', () => {
    assert.deepEqual([...SQLITE_HEADER_FIXED_BYTES], [64, 32, 32]);
  });

  it('builds a header whose bytes 21-23 are exactly those constants', () => {
    const buf = header();
    assert.deepEqual([...buf.subarray(21, 24)], [...SQLITE_HEADER_FIXED_BYTES]);
  });

  it('flags a corrupted byte 21 as a non-SQLite file', () => {
    // Stamp a would-be "LBS" marker where the marker used to be assumed.
    const buf = header();
    for (let i = 0; i < 'LBS'.length; i++) {
      buf[21 + i] = 'LBS'.charCodeAt(i);
    }
    assert.deepEqual([...buf.subarray(21, 24)], [76, 66, 83], 'the marker must be stamped');
    assert.equal(
      hasSqliteHeader(buf),
      true,
      'the magic still matches; only the constant bytes changed'
    );
    assert.deepEqual(
      detectLibSqlInHeader(buf),
      [],
      'altered bytes 21-23 are never accepted as LibSQL evidence'
    );
  });
});
