// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure DDL assembly for the "new table" flow.
 *
 * This module is the single authority on what DDL the extension is allowed to
 * emit for a new table, and it runs on BOTH sides of the bridge: the webview
 * calls it before sending `executeDdl`, and the extension host can re-run it to
 * reject non-portable DDL aimed at an engine that cannot run it. It imports
 * nothing but types — no `node:*`, no `vscode`, no DOM.
 *
 * The result is a *plan*, never a side effect: `buildNewTablePlan` only decides
 * whether a request is legal and what statements satisfy it. Executing them is
 * the caller's job.
 */

import type { DbEngine, LibSqlCapabilities } from './protocol';
import type { MessageKey } from './i18n';
import { quoteIdent } from './protocol';

/* ------------------------------------------------------------------------ */
/* Message keys                                                             */
/* ------------------------------------------------------------------------ */

/**
 * The message keys this module can return.
 *
 * WHY A LOCAL UNION INSTEAD OF `MessageKey`: the catalogue lives in
 * `src/shared/i18n/en.ts`, which this module does not own. Typing the returns as
 * `MessageKey` would make this file fail to compile until that catalogue
 * catches up, which is the wrong failure mode — the DDL logic is complete and
 * testable on its own, and the catalogue is additive.
 *
 * The `Extract` below is the bridge: the moment a key is added to the
 * catalogue, `Extract<MessageKey, DdlMessageKey>` starts resolving to the
 * literal instead of `never`, so a key that is misspelled or later renamed in
 * the catalogue degrades to `never` here and the assignment surfaces as an
 * error instead of silently shipping an untranslated key. Until then the
 * literal union keeps this module sound and keeps the public API honest about
 * which keys a caller must be able to translate.
 */
export type DdlMessageKey =
  | 'err.newTable.nameRequired'
  | 'err.newTable.nameInvalid'
  | 'err.newTable.nameExists'
  | 'err.newTable.idRequired'
  | 'err.newTable.idInvalid'
  | 'err.newTable.seqNameRequired'
  | 'err.newTable.seqNameInvalid'
  | 'err.newTable.seqNameIsTable'
  | 'err.newTable.seqNameIsColumn'
  | 'err.newTable.startInvalid'
  | 'err.newTable.incrementInvalid'
  | 'err.newTable.minInvalid'
  | 'err.newTable.maxInvalid'
  | 'err.newTable.incrementZero'
  | 'err.newTable.minNotBelowMax'
  | 'err.newTable.startBelowMin'
  | 'err.newTable.startAboveMax'
  | 'err.newTable.seqUnsupported'
  | 'warn.newTable.seqNameSameAsId';

/**
 * A key this module returns: the catalogue's own literal when it already
 * carries the key, otherwise the local literal, so the two stay in lockstep.
 */
type DdlKey<K extends DdlMessageKey> = Extract<MessageKey, K> extends never ? K : Extract<MessageKey, K>;

/* ------------------------------------------------------------------------ */
/* Types                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Raw options for a new table, mirroring the new-table dialog fields and the
 * `createTable` option object in `webview/src/hooks/useDatabaseState.ts`
 * EXACTLY. Fields are optional because the dialog leaves them empty until the
 * user turns AUTOINCREMENT + sequence on; the builder applies the defaults
 * documented on `DEFAULT_SEQUENCE_*` below.
 *
 * All numbers arrive as `number | undefined` rather than strings: parsing and
 * formatting are presentation concerns owned by the dialog.
 */
export interface NewTableOptions {
  /** Name of the table to create. Required, non-empty after trimming. */
  tableName: string;
  /**
   * Name of the INTEGER PRIMARY KEY column. Required, non-empty after
   * trimming.
   */
  idColumn: string;
  /**
   * When true the primary key is generated for the user. On plain SQLite this
   * means `INTEGER PRIMARY KEY AUTOINCREMENT`; on an engine implementing the
   * Turso Database sequence extension it may instead be backed by a named
   * `CREATE SEQUENCE` (see `sequenceName`).
   */
  autoIncrement: boolean;
  /**
   * Turso Database sequence extension only (NOT available in libSQL and not in
   * stock SQLite): name of the sequence to create and use as the column
   * default. Omitted means "use AUTOINCREMENT" even when the extension is
   * available.
   */
  sequenceName?: string;
  /** Sequence extension only: first value the sequence yields (`START WITH`). */
  startValue?: number;
  /** Sequence extension only: step between values (`INCREMENT BY`). Not 0. */
  incrementBy?: number;
  /** Sequence extension only: inclusive lower bound (`MINVALUE`). */
  minValue?: number;
  /** Sequence extension only: inclusive upper bound (`MAXVALUE`). */
  maxValue?: number;
}

/** Context the builder needs to choose a dialect and gate capabilities. */
export interface NewTableContext {
  /** Dialect driving the file; `sqlite` unless LibSQL was positively detected. */
  engine: DbEngine;
  /** Capability flags produced by detection, from `DatabaseInfo`. */
  capabilities: LibSqlCapabilities;
  /**
   * True only when the connected engine really implements the Turso Database
   * `CREATE SEQUENCE` extension.
   *
   * NOT implied by `engine === 'libsql'`: LibSQL is a fork of SQLite and does
   * not implement sequences at all (its grammar file has no `sequence` rule),
   * so treating "LibSQL" as "supports sequences" would emit DDL the engine
   * cannot parse. This is a separate, explicit capability on purpose.
   *
   * Absent means FALSE — the gate fails closed, so no caller can accidentally
   * emit non-portable DDL by omission.
   */
  sequencesSupported?: boolean;
  /**
   * Names of objects already present in the database, used for duplicate
   * detection. Matching is case-insensitive because SQLite identifiers are.
   */
  existingNames?: readonly string[];
}

/**
 * Discriminated result of `buildNewTablePlan`.
 *
 * On success the caller executes `statements` in order; `warningKeys` carries
 * message keys for non-fatal notices (e.g. a redundant AUTOINCREMENT keyword)
 * that should surface as toasts. On failure `errorKey` is a message key the
 * caller renders inline or throws with — the user is still editing a form, so
 * the failure is an expected outcome rather than an exception here.
 */
export type NewTablePlan =
  | {
      ok: true;
      /** Statements to execute, in order. Never empty. */
      statements: string[];
      /** Message keys for non-fatal notices; empty when there are none. */
      warningKeys: Array<DdlKey<'warn.newTable.seqNameSameAsId'>>;
    }
  | {
      ok: false;
      /** Message key naming the single blocking problem. */
      errorKey: DdlKey<DdlMessageKey>;
      /** Field the problem belongs to, for inline dialog highlighting. */
      field: NewTableField | null;
    };

/** Fields of `NewTableOptions` addressable by a validation message. */
export type NewTableField =
  | 'tableName'
  | 'idColumn'
  | 'autoIncrement'
  | 'sequenceName'
  | 'startValue'
  | 'incrementBy'
  | 'minValue'
  | 'maxValue';

/**
 * One validation problem, already localized-ready: `key` is a message key and
 * `field` tells the dialog which input to mark. Returned per-field so the
 * dialog can show every problem at once rather than one at a time.
 */
export interface NewTableValidationIssue {
  field: NewTableField;
  key: DdlKey<DdlMessageKey>;
}

/* ------------------------------------------------------------------------ */
/* Constants and documented rules                                           */
/* ------------------------------------------------------------------------ */

/**
 * Bounds applied to every user-supplied sequence number.
 *
 * RATIONALE: SQLite integers are signed 64-bit. The builder refuses values
 * outside that range up front rather than emitting SQL the engine will reject
 * with an opaque error. `Number.MAX_SAFE_INTEGER` rather than 2^63-1 is used
 * deliberately: the dialog passes values as JS numbers, so anything beyond the
 * safe range would already have lost precision before reaching us.
 */
export const SQLITE_INT_MIN = Number.MIN_SAFE_INTEGER;
export const SQLITE_INT_MAX = Number.MAX_SAFE_INTEGER;

/** Default `START WITH` when the dialog supplies none. */
export const DEFAULT_SEQUENCE_START = 1;
/** Default `INCREMENT BY` when the dialog supplies none. */
export const DEFAULT_SEQUENCE_INCREMENT = 1;

/** True for a finite, integral number inside the SQLite signed-64-bit range. */
function isSaneInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= SQLITE_INT_MIN && v <= SQLITE_INT_MAX;
}

/**
 * SQLite identifiers may not be empty and, when they contain anything beyond
 * `[A-Za-z0-9_]`, are only usable via quoting. We accept any non-empty trimmed
 * string that contains no NUL and no control characters: `quoteIdent` makes
 * even hostile-looking names safe, so rejecting exotic characters would only
 * remove legitimate capability without adding safety.
 */
function isUsableIdentifier(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[^\u0000-\u001f\u007f]+$/.test(name);
}

/* ------------------------------------------------------------------------ */
/* Validation                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Validate a new-table request and return every problem found, in field order.
 *
 * An empty array means the request is well formed; it does NOT mean the
 * request is supported by the current engine — that is `buildNewTablePlan`'s
 * decision, which additionally applies capability gating.
 *
 * The rules are intentionally explicit:
 *
 *  - `tableName` is required, must be a usable identifier, and must not collide
 *    (case-insensitively) with `ctx.existingNames`.
 *  - `idColumn` is required and must be a usable identifier.
 *  - A sequence-only field supplied while `autoIncrement` is off is ignored,
 *    not an error: the dialog keeps stale field values when the checkbox is
 *    cleared, and silently dropping them matches what was written.
 *  - When a sequence IS requested: `sequenceName` is required, must be a usable
 *    identifier, and must differ from the table name and the id column, since
 *    SQLite puts all of these in one schema namespace and a clash would make
 *    the script fail on its second statement.
 *  - `incrementBy` must be a sane integer and must not be 0 (the engine rejects
 *    a zero step and a zero step is meaningless).
 *  - `MINVALUE < MAXVALUE` is enforced by the engine, so we enforce it too;
 *    equal bounds would pin the sequence to a single value.
 *  - `startValue` must satisfy the engine's own directional rule: an ascending
 *    sequence needs `start >= min`, a descending one needs `start <= max`.
 */
export function validateNewTableOptions(
  options: NewTableOptions,
  ctx: { existingNames?: readonly string[] } = {}
): NewTableValidationIssue[] {
  const issues: NewTableValidationIssue[] = [];

  const tableName = typeof options.tableName === 'string' ? options.tableName.trim() : '';
  const idColumn = typeof options.idColumn === 'string' ? options.idColumn.trim() : '';

  /* ---- table name --------------------------------------------------- */
  if (tableName.length === 0) {
    issues.push({ field: 'tableName', key: 'err.newTable.nameRequired' });
  } else if (!isUsableIdentifier(tableName)) {
    issues.push({ field: 'tableName', key: 'err.newTable.nameInvalid' });
  } else {
    const existing = ctx.existingNames ?? [];
    const clash = existing.some((n) => typeof n === 'string' && n.toLowerCase() === tableName.toLowerCase());
    if (clash) {
      issues.push({ field: 'tableName', key: 'err.newTable.nameExists' });
    }
  }

  /* ---- id column ---------------------------------------------------- */
  if (idColumn.length === 0) {
    issues.push({ field: 'idColumn', key: 'err.newTable.idRequired' });
  } else if (!isUsableIdentifier(idColumn)) {
    issues.push({ field: 'idColumn', key: 'err.newTable.idInvalid' });
  }
  // An id column named the same as its table is legal in SQLite and produces
  // unambiguous SQL once quoted, so it is not flagged.

  /* ---- sequence ------------------------------------------------------ */
  const sequenceRequested = options.autoIncrement && typeof options.sequenceName !== 'undefined';
  const sequenceName = typeof options.sequenceName === 'string' ? options.sequenceName.trim() : '';

  if (sequenceRequested) {
    if (sequenceName.length === 0) {
      issues.push({ field: 'sequenceName', key: 'err.newTable.seqNameRequired' });
    } else if (!isUsableIdentifier(sequenceName)) {
      issues.push({ field: 'sequenceName', key: 'err.newTable.seqNameInvalid' });
    } else if (sequenceName.toLowerCase() === tableName.toLowerCase() && tableName.length > 0) {
      issues.push({ field: 'sequenceName', key: 'err.newTable.seqNameIsTable' });
    } else if (sequenceName.toLowerCase() === idColumn.toLowerCase() && idColumn.length > 0) {
      issues.push({ field: 'sequenceName', key: 'err.newTable.seqNameIsColumn' });
    }

    /* ---- numeric bounds ------------------------------------------- */
    const startValue = options.startValue;
    const incrementBy = options.incrementBy;
    const minValue = options.minValue;
    const maxValue = options.maxValue;

    const provided: Array<[NewTableField, unknown, DdlKey<DdlMessageKey>]> = [
      ['startValue', startValue, 'err.newTable.startInvalid'],
      ['incrementBy', incrementBy, 'err.newTable.incrementInvalid'],
      ['minValue', minValue, 'err.newTable.minInvalid'],
      ['maxValue', maxValue, 'err.newTable.maxInvalid']
    ];
    for (const [field, value, key] of provided) {
      if (typeof value !== 'undefined' && !isSaneInteger(value)) {
        issues.push({ field, key });
      }
    }

    const incrementOk = typeof incrementBy === 'undefined' || isSaneInteger(incrementBy);
    const minOk = typeof minValue === 'undefined' || isSaneInteger(minValue);
    const maxOk = typeof maxValue === 'undefined' || isSaneInteger(maxValue);
    const startOk = typeof startValue === 'undefined' || isSaneInteger(startValue);

    if (incrementOk && incrementBy === 0) {
      issues.push({ field: 'incrementBy', key: 'err.newTable.incrementZero' });
    }
    if (minOk && maxOk && minValue !== undefined && maxValue !== undefined && minValue >= maxValue) {
      issues.push({ field: 'maxValue', key: 'err.newTable.minNotBelowMax' });
    }

    // Mirror the engine's directional START rule, only when every value it
    // depends on is itself valid — otherwise we would report a second, derived
    // error on top of the real one.
    if (startOk && incrementOk && startValue !== undefined && incrementBy !== undefined) {
      const ascending = incrementBy > 0;
      if (ascending && minOk && minValue !== undefined && startValue < minValue) {
        issues.push({ field: 'startValue', key: 'err.newTable.startBelowMin' });
      }
      if (!ascending && incrementBy !== 0 && maxOk && maxValue !== undefined && startValue > maxValue) {
        issues.push({ field: 'startValue', key: 'err.newTable.startAboveMax' });
      }
    }
  }

  return issues;
}

/* ------------------------------------------------------------------------ */
/* Generation                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Decide whether a request is legal for the current engine, and if so assemble
 * the statements that satisfy it.
 *
 * Capability gating is authoritative here, deliberately ABOVE the dialog: the
 * dialog disables the sequence fields when the engine lacks the extension, but
 * a stale webview or a direct caller must not be able to post non-portable DDL
 * to an engine that cannot run it. When a sequence is requested and
 * `ctx.sequencesSupported` is not exactly `true`, the plan fails with
 * `err.newTable.seqUnsupported` instead of quietly falling back to
 * AUTOINCREMENT, because the two produce different numbers and silently
 * changing the user's request would corrupt their expectations of the ids.
 *
 * Generated SQL:
 *
 *  - SQLite baseline (always correct, every engine):
 *      CREATE TABLE "t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)
 *  - Turso Database sequence extension (requires `sequencesSupported: true`):
 *      CREATE SEQUENCE "s" START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 100
 *      CREATE TABLE "t" ("id" INTEGER PRIMARY KEY DEFAULT (nextval('s')))
 *
 * The sequence branch is verified against the Turso Database documentation but
 * is DORMANT: no engine this extension currently ships implements the
 * extension, so nothing sets `sequencesSupported`. See `isSequenceDdlAvailable`.
 *
 * Every identifier goes through `quoteIdent`; no user string is ever
 * concatenated into SQL raw.
 */
export function buildNewTablePlan(options: NewTableOptions, ctx: NewTableContext): NewTablePlan {
  const issues = validateNewTableOptions(options, { existingNames: ctx.existingNames });
  const first = issues[0];
  if (first) {
    return { ok: false, errorKey: first.key, field: first.field };
  }

  const tableName = options.tableName.trim();
  const idColumn = options.idColumn.trim();
  const sequenceRequested = options.autoIncrement && typeof options.sequenceName !== 'undefined';

  // Capability gate: the pure layer is the authority, not the dialog.
  if (sequenceRequested && !isSequenceDdlAvailable(ctx)) {
    return { ok: false, errorKey: 'err.newTable.seqUnsupported', field: 'sequenceName' };
  }

  const warningKeys: Array<DdlKey<'warn.newTable.seqNameSameAsId'>> = [];

  /* ---- SQLite baseline ------------------------------------------------ */
  if (!sequenceRequested) {
    // `autoIncrement: false` yields a plain `INTEGER PRIMARY KEY`, which is
    // still rowid-aliased and auto-assigning; the extra keyword only changes
    // rowid reuse. A caller that asked for no autoincrement gets the bare form.
    const column = options.autoIncrement
      ? `${quoteIdent(idColumn)} INTEGER PRIMARY KEY AUTOINCREMENT`
      : `${quoteIdent(idColumn)} INTEGER PRIMARY KEY`;
    return {
      ok: true,
      statements: [`CREATE TABLE ${quoteIdent(tableName)} (${column})`],
      warningKeys
    };
  }

  /* ---- Turso Database sequence extension ------------------------------ */
  // Verified grammar (Turso Database, https://docs.turso.tech):
  //   CREATE SEQUENCE [IF NOT EXISTS] name [START [WITH] n] [INCREMENT [BY] n]
  //     [MINVALUE n] [MAXVALUE n] [CYCLE | NO CYCLE]
  // This is NOT libSQL and NOT stock SQLite; reachable only via
  // `sequencesSupported: true`.
  const sequenceName = (options.sequenceName ?? '').trim();
  const start = options.startValue ?? DEFAULT_SEQUENCE_START;
  const increment = options.incrementBy ?? DEFAULT_SEQUENCE_INCREMENT;

  if (idColumn.toLowerCase() === sequenceName.toLowerCase()) {
    // Not fatal — SQLite keeps sequences and columns in separate namespaces in
    // practice — but worth surfacing because it reads as a mistake.
    warningKeys.push('warn.newTable.seqNameSameAsId');
  }

  const parts = [`CREATE SEQUENCE ${quoteIdent(sequenceName)}`, `START WITH ${start}`];
  if (options.incrementBy !== undefined) {
    parts.push(`INCREMENT BY ${increment}`);
  }
  if (options.minValue !== undefined) {
    parts.push(`MINVALUE ${options.minValue}`);
  }
  if (options.maxValue !== undefined) {
    parts.push(`MAXVALUE ${options.maxValue}`);
  }
  const createSequence = parts.join(' ');

  const createTable =
    `CREATE TABLE ${quoteIdent(tableName)} ` +
    `(${quoteIdent(idColumn)} INTEGER PRIMARY KEY DEFAULT (nextval(${quoteLiteralString(sequenceName)})))`;

  return { ok: true, statements: [createSequence, createTable], warningKeys };
}

/**
 * True only when the context explicitly opts in to the Turso Database sequence
 * extension.
 *
 * DELIBERATELY FAIL-CLOSED. Every other signal is unusable as a proxy:
 *
 *  - `engine === 'libsql'` does NOT imply sequences. LibSQL is a C fork of
 *    SQLite and its parser has no `CREATE SEQUENCE` rule at all, so gating on
 *    the engine name would emit SQL that fails at runtime.
 *  - `capabilities` describes LibSQL features (strict tables, vector search,
 *    replicas). None of them corresponds to sequences, and reusing one — say
 *    `embeddedReplicas` — would make two unrelated features share a switch.
 *
 * So an absent flag means "unsupported". Callers must opt in explicitly.
 *
 * The shipping engine (Turso Database) DOES implement the extension, so the
 * sequence path below is live: the adapter reports `capabilities.sequences` and
 * the callers pass it through as `sequencesSupported`. It is still gated rather
 * than assumed, so opening an ordinary SQLite file — where the builder is not
 * driving a sequence anyway — can never emit non-portable DDL by accident.
 */
function isSequenceDdlAvailable(ctx: NewTableContext): boolean {
  return ctx.sequencesSupported === true;
}

/** Quote a string literal for SQL (sequences take a name, not an identifier). */
function quoteLiteralString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
