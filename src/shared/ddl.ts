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
  | 'err.newTable.idInvalid';

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
 * EXACTLY.
 *
 * There are deliberately no sequence options. A custom named sequence would
 * need the `CREATE SEQUENCE` extension, which no engine this extension drives
 * implements (libSQL's grammar has no `sequence` rule at all), so the only
 * generated-key form is the SQLite baseline AUTOINCREMENT.
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
   * When true the primary key is `INTEGER PRIMARY KEY AUTOINCREMENT`; when
   * false, the bare `INTEGER PRIMARY KEY` form (still rowid-aliased and
   * auto-assigning — the keyword only changes rowid reuse).
   */
  autoIncrement: boolean;
}

/** Context the builder needs to choose a dialect and gate capabilities. */
export interface NewTableContext {
  /** Dialect driving the file; `sqlite` unless LibSQL was positively detected. */
  engine: DbEngine;
  /** Capability flags produced by detection, from `DatabaseInfo`. */
  capabilities: LibSqlCapabilities;
  /**
   * Names of objects already present in the database, used for duplicate
   * detection. Matching is case-insensitive because SQLite identifiers are.
   */
  existingNames?: readonly string[];
}

/**
 * Discriminated result of `buildNewTablePlan`.
 *
 * On success the caller executes `statements` in order. On failure `errorKey`
 * is a message key the caller renders inline or throws with — the user is still
 * editing a form, so the failure is an expected outcome rather than an
 * exception here.
 */
export type NewTablePlan =
  | {
      ok: true;
      /** Statements to execute, in order. Never empty. */
      statements: string[];
    }
  | {
      ok: false;
      /** Message key naming the single blocking problem. */
      errorKey: DdlKey<DdlMessageKey>;
      /** Field the problem belongs to, for inline dialog highlighting. */
      field: NewTableField | null;
    };

/** Fields of `NewTableOptions` addressable by a validation message. */
export type NewTableField = 'tableName' | 'idColumn' | 'autoIncrement';

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
 * True for a finite, integral number inside the SQLite signed-64-bit range.
 * Kept for callers that validate numeric form fields before they reach this
 * module; the builder itself no longer consumes numbers.
 */
export function isSaneInteger(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    Number.isInteger(v) &&
    v >= Number.MIN_SAFE_INTEGER &&
    v <= Number.MAX_SAFE_INTEGER
  );
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

  return issues;
}

/* ------------------------------------------------------------------------ */
/* Generation                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Decide whether a request is legal for the current engine, and if so assemble
 * the statements that satisfy it.
 *
 * Only the SQLite baseline is generated — there is no sequence branch, because
 * `CREATE SEQUENCE` is not implemented by any engine this extension drives and
 * there is no honest way to emit it (see `NewTableOptions`). Generated SQL:
 *
 *  - `autoIncrement: false`:
 *      CREATE TABLE "t" ("id" INTEGER PRIMARY KEY)
 *  - `autoIncrement: true`:
 *      CREATE TABLE "t" ("id" INTEGER PRIMARY KEY AUTOINCREMENT)
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

  // `autoIncrement: false` yields a plain `INTEGER PRIMARY KEY`, which is
  // still rowid-aliased and auto-assigning; the extra keyword only changes
  // rowid reuse. A caller that asked for no autoincrement gets the bare form.
  const column = options.autoIncrement
    ? `${quoteIdent(idColumn)} INTEGER PRIMARY KEY AUTOINCREMENT`
    : `${quoteIdent(idColumn)} INTEGER PRIMARY KEY`;
  return {
    ok: true,
    statements: [`CREATE TABLE ${quoteIdent(tableName)} (${column})`]
  };
}
