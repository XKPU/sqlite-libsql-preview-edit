// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildNewTablePlan, validateNewTableOptions, type NewTableOptions } from '../src/shared/ddl';
import { LIBSQL_CAPABILITIES, SQLITE_CAPABILITIES, splitStatements } from '../src/shared/protocol';

const SQLITE_CTX = { engine: 'sqlite' as const, capabilities: SQLITE_CAPABILITIES };
/**
 * LibSQL detected. LibSQL is a fork of SQLite and has no `CREATE SEQUENCE`
 * rule; the builder generates only the SQLite baseline either way.
 */
const LIBSQL_CTX = { engine: 'libsql' as const, capabilities: LIBSQL_CAPABILITIES };

/** Minimal valid options; individual tests override what they exercise. */
function opts(over: Partial<NewTableOptions> = {}): NewTableOptions {
  return { tableName: 'items', idColumn: 'id', autoIncrement: false, ...over };
}

/** Error keys of a validation run, for compact assertions. */
function keysOf(issues: ReturnType<typeof validateNewTableOptions>): string[] {
  return issues.map((i) => i.key);
}

describe('buildNewTablePlan: SQLite baseline', () => {
  it('emits AUTOINCREMENT for a plain autoincrement table', () => {
    const plan = buildNewTablePlan(opts({ autoIncrement: true }), SQLITE_CTX);
    assert.equal(plan.ok, true);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT)']);
  });

  it('emits a bare INTEGER PRIMARY KEY when autoincrement is off', () => {
    const plan = buildNewTablePlan(opts(), SQLITE_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE items (id INTEGER PRIMARY KEY)']);
  });

  it('honours custom table and column names', () => {
    const plan = buildNewTablePlan(opts({ tableName: 'users', idColumn: 'user_id', autoIncrement: true }), SQLITE_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE users (user_id INTEGER PRIMARY KEY AUTOINCREMENT)']);
  });

  it('uses AUTOINCREMENT on libSQL too (the baseline is the only generated-key form)', () => {
    const plan = buildNewTablePlan(opts({ autoIncrement: true }), LIBSQL_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT)']);
  });
});

describe('buildNewTablePlan: identifier quoting', () => {
  it('leaves simple identifiers unquoted', () => {
    const plan = buildNewTablePlan(opts({ tableName: 'a_b1', idColumn: '_x' }), SQLITE_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE a_b1 (_x INTEGER PRIMARY KEY)']);
  });

  it('quotes and escapes an embedded double quote', () => {
    const plan = buildNewTablePlan(opts({ tableName: 'we"ird', idColumn: 'i"d' }), SQLITE_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE "we""ird" ("i""d" INTEGER PRIMARY KEY)']);
  });

  it('neutralises a statement-terminator injection attempt', () => {
    const plan = buildNewTablePlan(opts({ tableName: 'x; DROP TABLE users; --' }), SQLITE_CTX);
    assert.ok(plan.ok);
    const sql = plan.statements[0] ?? '';
    // The whole payload must survive as ONE quoted identifier...
    assert.equal(sql, 'CREATE TABLE "x; DROP TABLE users; --" (id INTEGER PRIMARY KEY)');
    // ...and `splitStatements` — the function the host actually uses before
    // executing generated SQL — must therefore see exactly ONE statement. This
    // is the assertion that matters: if quoting were skipped, the semicolon
    // would split here and a second DROP TABLE would reach the driver.
    assert.deepEqual(splitStatements(sql), [
      'CREATE TABLE "x; DROP TABLE users; --" (id INTEGER PRIMARY KEY)'
    ]);
    assert.equal(sql.includes('DROP TABLE users; --'), true);
  });

  it('never emits an unquoted name for a spaced identifier', () => {
    const plan = buildNewTablePlan(opts({ tableName: 'my table' }), SQLITE_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE "my table" (id INTEGER PRIMARY KEY)']);
  });
});

describe('validateNewTableOptions: table name', () => {
  it('requires a table name', () => {
    assert.deepEqual(keysOf(validateNewTableOptions(opts({ tableName: '' }))), ['err.newTable.nameRequired']);
    assert.deepEqual(keysOf(validateNewTableOptions(opts({ tableName: '   ' }))), ['err.newTable.nameRequired']);
  });

  it('rejects control characters in the table name', () => {
    assert.deepEqual(keysOf(validateNewTableOptions(opts({ tableName: 'a\u0000b' }))), ['err.newTable.nameInvalid']);
  });

  it('detects a duplicate against existing names, case-insensitively', () => {
    const issues = validateNewTableOptions(opts({ tableName: 'Items' }), { existingNames: ['items', 'other'] });
    assert.deepEqual(keysOf(issues), ['err.newTable.nameExists']);
    assert.equal(issues[0]?.field, 'tableName');
  });

  it('accepts a name absent from the existing list', () => {
    assert.deepEqual(validateNewTableOptions(opts({ tableName: 'fresh' }), { existingNames: ['items'] }), []);
  });
});

describe('validateNewTableOptions: id column', () => {
  it('requires an id column', () => {
    assert.deepEqual(keysOf(validateNewTableOptions(opts({ idColumn: '  ' }))), ['err.newTable.idRequired']);
  });

  it('rejects control characters in the id column', () => {
    assert.deepEqual(keysOf(validateNewTableOptions(opts({ idColumn: 'a\u001fb' }))), ['err.newTable.idInvalid']);
  });

  it('reports EVERY problem at once so the dialog can mark all fields inline', () => {
    // The dialog renders a per-field message, so validation must not stop at the
    // first problem the way buildNewTablePlan does.
    const issues = validateNewTableOptions(opts({ tableName: '', idColumn: '' }));
    assert.deepEqual(keysOf(issues), ['err.newTable.nameRequired', 'err.newTable.idRequired']);
    // Each issue names the field it belongs to, with no duplicates.
    assert.deepEqual(issues.map((i) => i.field), ['tableName', 'idColumn']);
  });
});

describe('buildNewTablePlan: capability context is accepted but inert', () => {
  it('ignores capabilities beyond the SQLite baseline', () => {
    // The context still takes engine/capabilities for future gating, but no
    // option can turn a non-baseline feature on, so both engines get the same
    // plan for the same options.
    const a = buildNewTablePlan(opts({ autoIncrement: true }), SQLITE_CTX);
    const b = buildNewTablePlan(opts({ autoIncrement: true }), LIBSQL_CTX);
    assert.deepEqual(a, b);
  });

  it('reports validation failures before generation', () => {
    const plan = buildNewTablePlan(opts({ tableName: '' }), SQLITE_CTX);
    // `assert.ok` does not narrow the discriminated union for the compiler, so
    // narrow explicitly; the throw still fails the test if the plan succeeded.
    if (plan.ok) throw new Error('expected the plan to be refused');
    assert.equal(plan.errorKey, 'err.newTable.nameRequired');
    assert.equal(plan.field, 'tableName');
  });

  it('ignores unknown extra fields from an untyped caller', () => {
    // The option object can arrive from JSON with stale fields (the dialog once
    // sent sequence options); they must be ignored, not crash the builder.
    const plan = buildNewTablePlan(
      { ...opts({ autoIncrement: true }), sequenceName: 'stale' } as unknown as NewTableOptions,
      SQLITE_CTX
    );
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.deepEqual(plan.statements, ['CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT)']);
    }
  });
});
