// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildNewTablePlan,
  validateNewTableOptions,
  type NewTableOptions
} from '../src/shared/ddl';
import { LIBSQL_CAPABILITIES, SQLITE_CAPABILITIES, splitStatements } from '../src/shared/protocol';

const SQLITE_CTX = { engine: 'sqlite' as const, capabilities: SQLITE_CAPABILITIES };
/**
 * LibSQL detected, all LibSQL capabilities on, but WITHOUT the sequence
 * extension. This is the situation every engine we ship is in: LibSQL is a fork
 * of SQLite and has no `CREATE SEQUENCE` rule.
 */
const LIBSQL_CTX = { engine: 'libsql' as const, capabilities: LIBSQL_CAPABILITIES };
/**
 * An engine that genuinely implements the Turso Database sequence extension.
 * Nothing we ship can set this today; the flag exists as the seam for one that
 * can.
 */
const SEQ_CTX = {
  engine: 'libsql' as const,
  capabilities: LIBSQL_CAPABILITIES,
  sequencesSupported: true
};

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
    assert.deepEqual(plan.warningKeys, []);
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

  it('quotes a sequence name containing a quote character', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'se"q', startValue: 5 }),
      SEQ_CTX
    );
    assert.ok(plan.ok);
    assert.equal(plan.statements[0], 'CREATE SEQUENCE "se""q" START WITH 5');
    // The DEFAULT expression takes the name as a string LITERAL, so the quote is
    // doubled for the string rule, not the identifier rule.
    assert.equal(
      plan.statements[1],
      "CREATE TABLE items (id INTEGER PRIMARY KEY DEFAULT (nextval('se\"q')))"
    );
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
});

describe('validateNewTableOptions: sequence bounds', () => {
  it('requires a sequence name when a sequence is requested', () => {
    const issues = validateNewTableOptions(opts({ autoIncrement: true, sequenceName: '  ' }));
    assert.deepEqual(keysOf(issues), ['err.newTable.seqNameRequired']);
  });

  it('rejects a sequence name equal to the table name', () => {
    const issues = validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 'ITEMS' }));
    assert.deepEqual(keysOf(issues), ['err.newTable.seqNameIsTable']);
  });

  it('rejects a sequence name equal to the id column', () => {
    const issues = validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 'ID' }));
    assert.deepEqual(keysOf(issues), ['err.newTable.seqNameIsColumn']);
  });

  it('rejects incrementBy = 0', () => {
    const issues = validateNewTableOptions(
      opts({ autoIncrement: true, sequenceName: 's', incrementBy: 0 })
    );
    assert.deepEqual(keysOf(issues), ['err.newTable.incrementZero']);
    assert.equal(issues[0]?.field, 'incrementBy');
  });

  it('rejects MINVALUE >= MAXVALUE', () => {
    assert.deepEqual(
      keysOf(validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 's', minValue: 10, maxValue: 5 }))),
      ['err.newTable.minNotBelowMax']
    );
    assert.deepEqual(
      keysOf(validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 's', minValue: 5, maxValue: 5 }))),
      ['err.newTable.minNotBelowMax']
    );
  });

  it('rejects non-integer and non-finite bounds', () => {
    assert.deepEqual(
      keysOf(validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 's', startValue: 1.5 }))),
      ['err.newTable.startInvalid']
    );
    assert.deepEqual(
      keysOf(validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 's', incrementBy: Number.NaN }))),
      ['err.newTable.incrementInvalid']
    );
    assert.deepEqual(
      keysOf(validateNewTableOptions(opts({ autoIncrement: true, sequenceName: 's', minValue: Number.POSITIVE_INFINITY }))),
      ['err.newTable.minInvalid']
    );
  });

  it('rejects a START below MINVALUE for an ascending sequence', () => {
    const issues = validateNewTableOptions(
      opts({ autoIncrement: true, sequenceName: 's', startValue: 1, incrementBy: 1, minValue: 10, maxValue: 100 })
    );
    assert.deepEqual(keysOf(issues), ['err.newTable.startBelowMin']);
  });

  it('rejects a START above MAXVALUE for a descending sequence', () => {
    const issues = validateNewTableOptions(
      opts({ autoIncrement: true, sequenceName: 's', startValue: 500, incrementBy: -1, minValue: 1, maxValue: 100 })
    );
    assert.deepEqual(keysOf(issues), ['err.newTable.startAboveMax']);
  });

  it('accepts a valid descending sequence', () => {
    assert.deepEqual(
      validateNewTableOptions(
        opts({ autoIncrement: true, sequenceName: 's', startValue: 10, incrementBy: -1, minValue: 1, maxValue: 100 })
      ),
      []
    );
  });

  it('ignores sequence fields when autoIncrement is off', () => {
    assert.deepEqual(
      validateNewTableOptions(opts({ tableName: 'items', autoIncrement: false, sequenceName: 'items' })),
      []
    );
  });

  it('accepts a fully specified valid sequence', () => {
    assert.deepEqual(
      validateNewTableOptions(
        opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 1000, incrementBy: 5, minValue: 1, maxValue: 999999 })
      ),
      []
    );
  });

  it('reports EVERY problem at once so the dialog can mark all fields inline', () => {
    // The dialog renders a per-field message, so validation must not stop at the
    // first problem the way buildNewTablePlan does.
    const issues = validateNewTableOptions(
      opts({ tableName: '', idColumn: '', autoIncrement: true, sequenceName: '', incrementBy: 0, minValue: 10, maxValue: 5 })
    );
    assert.deepEqual(keysOf(issues), [
      'err.newTable.nameRequired',
      'err.newTable.idRequired',
      'err.newTable.seqNameRequired',
      'err.newTable.incrementZero',
      'err.newTable.minNotBelowMax'
    ]);
    // Each issue names the field it belongs to, with no duplicates.
    assert.deepEqual(issues.map((i) => i.field), [
      'tableName',
      'idColumn',
      'sequenceName',
      'incrementBy',
      'maxValue'
    ]);
  });

  it('does not pile a derived START error on top of a broken bound', () => {
    // minValue is invalid, so the ascending START rule cannot be evaluated.
    // Only the root cause is reported, not a second, misleading message.
    const issues = validateNewTableOptions(
      opts({ autoIncrement: true, sequenceName: 's', startValue: 5, incrementBy: 1, minValue: Number.NaN, maxValue: 100 })
    );
    assert.deepEqual(keysOf(issues), ['err.newTable.minInvalid']);
  });

  it('tolerates a non-string sequenceName from an untyped caller', () => {
    // The option can arrive from JSON, so a non-string must not crash the
    // validator; it is treated as a missing name.
    const issues = validateNewTableOptions(
      opts({ autoIncrement: true, sequenceName: 42 as unknown as string })
    );
    assert.deepEqual(keysOf(issues), ['err.newTable.seqNameRequired']);
  });
});

describe('buildNewTablePlan: capability gating', () => {
  it('refuses a sequence on plain SQLite', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 1 }),
      SQLITE_CTX
    );
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok);
    assert.equal(plan.errorKey, 'err.newTable.seqUnsupported');
    assert.equal(plan.field, 'sequenceName');
  });

  it('REGRESSION: refuses a sequence on libSQL even with every LibSQL capability on', () => {
    // The key correctness property of this module. libSQL is a C fork of SQLite
    // whose grammar has no `CREATE SEQUENCE` rule, so a LibSQL file with all
    // capabilities enabled still cannot run sequence DDL. Gating on
    // `engine === 'libsql'` would emit SQL that fails at runtime; the gate must
    // require an explicit `sequencesSupported` opt-in instead.
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 1 }),
      LIBSQL_CTX
    );
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok);
    assert.equal(plan.errorKey, 'err.newTable.seqUnsupported');
  });

  it('fails closed when sequencesSupported is explicitly false', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq' }),
      { engine: 'libsql', capabilities: LIBSQL_CAPABILITIES, sequencesSupported: false }
    );
    assert.equal(plan.ok, false);
  });

  it('fails closed when sequencesSupported is merely truthy but not true', () => {
    // Guard against a caller passing 1/'yes' from JSON or a checkbox value: the
    // gate compares against the boolean literal, so nothing sloppy slips past.
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq' }),
      { engine: 'libsql', capabilities: LIBSQL_CAPABILITIES, sequencesSupported: 1 as unknown as boolean }
    );
    assert.equal(plan.ok, false);
  });

  it('does NOT silently fall back to AUTOINCREMENT when gated', () => {
    const plan = buildNewTablePlan(opts({ autoIncrement: true, sequenceName: 'items_seq' }), SQLITE_CTX);
    assert.equal(plan.ok, false);
    // A refused plan must carry no SQL to execute, so the caller cannot run it.
    // (Narrowing by `if (plan.ok)` rather than reading `plan.statements`, whose
    // type TypeScript has already collapsed to `never` after the assert above.)
    if (plan.ok) throw new Error('expected the sequence request to be refused');
    assert.equal(plan.errorKey, 'err.newTable.seqUnsupported');
  });

  it('allows a sequence only when sequencesSupported is explicitly true', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq' }),
      SEQ_CTX
    );
    assert.equal(plan.ok, true);
  });

  it('reports validation failures before capability failures', () => {
    const plan = buildNewTablePlan(opts({ tableName: '', autoIncrement: true, sequenceName: 's' }), SQLITE_CTX);
    // `assert.ok` does not narrow the discriminated union for the compiler, so
    // narrow explicitly; the throw still fails the test if the plan succeeded.
    if (plan.ok) throw new Error('expected the plan to be refused');
    assert.equal(plan.errorKey, 'err.newTable.nameRequired');
  });
});

describe('buildNewTablePlan: Turso Database sequence form (dormant)', () => {
  it('emits CREATE SEQUENCE then the table with a nextval default', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 1000, incrementBy: 5, minValue: 1, maxValue: 99999 }),
      SEQ_CTX
    );
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, [
      'CREATE SEQUENCE items_seq START WITH 1000 INCREMENT BY 5 MINVALUE 1 MAXVALUE 99999',
      "CREATE TABLE items (id INTEGER PRIMARY KEY DEFAULT (nextval('items_seq')))"
    ]);
  });

  it('emits only START WITH when no other bounds are given', () => {
    const plan = buildNewTablePlan(opts({ autoIncrement: true, sequenceName: 'items_seq' }), SEQ_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, [
      'CREATE SEQUENCE items_seq START WITH 1',
      "CREATE TABLE items (id INTEGER PRIMARY KEY DEFAULT (nextval('items_seq')))"
    ]);
  });

  it('applies the documented default increment of 1', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 7 }),
      SEQ_CTX
    );
    assert.ok(plan.ok);
    assert.equal(plan.statements[0], 'CREATE SEQUENCE items_seq START WITH 7');
  });

  it('emits INCREMENT BY for a descending sequence', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 100, incrementBy: -1 }),
      SEQ_CTX
    );
    assert.ok(plan.ok);
    assert.equal(plan.statements[0], 'CREATE SEQUENCE items_seq START WITH 100 INCREMENT BY -1');
  });

  it('supports negative MINVALUE', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'items_seq', startValue: 0, minValue: -100, maxValue: 100 }),
      SEQ_CTX
    );
    assert.ok(plan.ok);
    assert.equal(plan.statements[0], 'CREATE SEQUENCE items_seq START WITH 0 MINVALUE -100 MAXVALUE 100');
  });

  it('quotes a sequence name that needs it', () => {
    const plan = buildNewTablePlan(
      opts({ autoIncrement: true, sequenceName: 'my seq' }),
      SEQ_CTX
    );
    assert.ok(plan.ok);
    assert.equal(plan.statements[0], 'CREATE SEQUENCE "my seq" START WITH 1');
    assert.equal(plan.statements[1], "CREATE TABLE items (id INTEGER PRIMARY KEY DEFAULT (nextval('my seq')))");
  });

  it('uses AUTOINCREMENT on LibSQL when no sequence name is supplied', () => {
    const plan = buildNewTablePlan(opts({ autoIncrement: true }), LIBSQL_CTX);
    assert.ok(plan.ok);
    assert.deepEqual(plan.statements, ['CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT)']);
  });
});
