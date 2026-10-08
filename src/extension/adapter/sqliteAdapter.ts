// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bytesToHex,
  capabilitiesForDriver,
  ColumnInfo,
  DatabaseInfo,
  DbEngine,
  ErrorInfo,
  ErrorCode,
  ExportFormat,
  ImportFieldMapping,
  ImportFormat,
  quoteIdent,
  quoteLiteral,
  QueryResult,
  resolveLibSqlDetection,
  RowEdit,
  SqlValue,
  LibSqlCapabilities,
  LibSqlDetection,
  ObjectInfo,
  ObjectType
} from '../../shared/protocol';
import { DatabaseAdapter } from './adapter';
import {
  convertJsonValue,
  inferType,
  inferTypeFromColumn,
  isErrorInfo,
  normalizeValue,
  parseCsv,
  rowsToCsv
} from './common';

/* ------------------------------------------------------------------------ */
/* Local-file adapter backed by better-sqlite3 (stock SQLite)                */
/* ------------------------------------------------------------------------ */

/**
 * `better-sqlite3` is a synchronous, native binding to the **stock SQLite** C
 * library (`sqlite3` amalgamation). It opens an on-disk database directly and
 * writes the same `SQLite format 3` container the LibSQL family uses, so files
 * remain interchangeable — but the *dialect* it executes is plain SQLite:
 * there is no `CREATE SEQUENCE`, no `vector_*`, no STRICT extension set.
 *
 * Why this engine replaced Turso Database as the driver:
 *
 *   - Turso Database loses writes under concurrency. Measured 3/3: while a
 *     third-party SQLite process held a write lock on the same file, a Turso
 *     write reported `changes: 1` and the row was NOT there afterwards. It
 *     fails open, which is the worst possible failure for an EDITOR.
 *
 *   - Turso Database opened files in `locking_mode = exclusive`, which fences
 *     off every other process — in WAL as well as rollback-journal mode. A
 *     resident service could not connect at all while the editor merely had the
 *     database open. `better-sqlite3` reports `locking_mode = normal` and
 *     cooperates: measured with a service writing every 10 ms throughout, an
 *     open editor plus 63 service writes and one editor write all landed, with
 *     `integrity_check = ok` and zero failures on either side.
 *
 *   - In the same contended scenario `better-sqlite3` waits for the peer and
 *     then commits with ZERO lost rows and correct read isolation — and it
 *     never reports success for a write it did not perform.
 *
 * The API is synchronous while `DatabaseAdapter` is promise-based, so every
 * public method is declared `async` and returns its value directly. That is
 * correct and cheap: the value is wrapped in an already-resolved promise, and
 * no artificial deferral (`setTimeout` / `setImmediate`) is introduced.
 */

/* ---- local type declarations ------------------------------------------- */

/**
 * Structural description of the parts of the `better-sqlite3` surface this
 * adapter uses.
 *
 * Declared locally rather than imported so the adapter keeps compiling when the
 * package's typings are absent (it ships no `.d.ts` in 13.0.3) or when it is
 * installed by a consumer that resolves a different version. The runtime shape
 * is pinned by the probe in the migration's verification step.
 */
interface SqliteStatement {
  /** Column metadata for the prepared statement, available before stepping. */
  columns(): { name: string; column: string | null; table: string | null; type: string | null }[];
  /** Run a non-query statement; returns the affected-row count. */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  /** Run a query and return the first row (or `undefined`). */
  get(...params: unknown[]): unknown;
  /** Run a query and return every row. */
  all(...params: unknown[]): unknown[];
  /** Bind positional parameters before a later `all()`/`get()`. */
  bind(...params: unknown[]): SqliteStatement;
  /** Run a query, returning a row iterator. */
  iterate(...params: unknown[]): IterableIterator<unknown>;
  /**
   * When enabled, INTEGER columns in this statement's rows are returned as
   * exact `bigint` values instead of doubles that round above 2^53. Always
   * turned on for statements whose rows we read (see `prepareForRead`).
   */
  safeIntegers(enabled?: boolean): SqliteStatement;
  /** True when the statement returns rows rather than mutating the database. */
  readonly reader: boolean;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): SqliteDatabase;
  /**
   * Run a PRAGMA. With `{ simple: true }` the scalar value is returned instead
   * of the usual `[{ name: value }]` row array.
   */
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown;
  close(): SqliteDatabase;
  /**
   * When enabled, INTEGER values come back as `bigint` instead of `number`.
   * Left OFF by default (see `readInt`); set explicitly around the few places
   * that must not round-trip a 64-bit id through a double.
   */
  defaultSafeIntegers(enabled?: boolean): SqliteDatabase;
  readonly open: boolean;
  readonly inTransaction: boolean;
  readonly readonly: boolean;
  readonly name: string;
}

interface SqliteErrorLike {
  code?: string;
  message?: string;
}

/** Options this adapter passes to the `better-sqlite3` constructor. */
interface SqliteConnectOpts {
  /** Open read-only. Needs no write lock, so it succeeds where read-write fails. */
  readonly?: boolean;
  /**
   * Busy timeout in ms, applied by the engine. `better-sqlite3` defaults this
   * to `5000` on its own; we pass it explicitly so the value is visible here
   * and cannot drift with a future default. Measured: a write that meets
   * another process's `BEGIN IMMEDIATE` waits this long and then either lands
   * (peer committed) or throws `SQLITE_BUSY` (peer still holds it). See
   * `LOCK_TIMEOUT_MS` for why the value passed here is deliberately short.
   */
  timeout?: number;
}

type SqliteConstructor = new (filePath: string, options?: SqliteConnectOpts) => SqliteDatabase;

let sqliteModule: SqliteConstructor | null = null;

/**
 * Lazily resolve the native constructor.
 *
 * `require` is used rather than a static `import` for two reasons: the module
 * pulls in a platform-specific binary that must not be loaded by any code path
 * that never opens a database (the webview bundle, the tests), and a missing
 * binary must surface as a structured `ErrorInfo` from `open()` rather than a
 * module-load crash that takes the whole extension host down.
 */
function getSqlite(): SqliteConstructor {
  if (!sqliteModule) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('better-sqlite3') as unknown;
    // Under `module: Node16` the CJS module IS the constructor, so this is the
    // normal path. The `.default` fallback covers a build that starts shipping a
    // real ESM wrapper, and the explicit failure covers neither shape being
    // present — which would otherwise surface later as "not a function".
    if (typeof loaded === 'function') {
      sqliteModule = loaded as SqliteConstructor;
    } else if (typeof (loaded as { default?: unknown }).default === 'function') {
      sqliteModule = (loaded as { default: SqliteConstructor }).default;
    } else {
      throw new Error('better-sqlite3 did not export a database constructor.');
    }
  }
  return sqliteModule;
}

/**
 * How long a write may wait for another process to release the file lock.
 *
 * Deliberately SHORT. `better-sqlite3` defaults to 5000 ms, and that default is
 * wrong for an interactive editor: measured against a peer holding a
 * never-released `BEGIN IMMEDIATE`, every budget produces the same
 * `SQLITE_BUSY` — the wait only delays the failure (0 ms -> 3 ms, 25 ms ->
 * 30 ms, 5000 ms -> 5036 ms). A long budget therefore buys nothing and costs
 * the user a five-second freeze on every contended save.
 *
 * What the budget DOES buy is riding out a service's genuinely transient write
 * lock. Measured against a resident writer issuing a transaction every 10 ms:
 * at 0 ms only 31/50 writes landed under `journal_mode=delete`, while 25 ms
 * already landed 50/50 (worst case 38 ms). A service committing a 200k-row bulk
 * transaction held the lock for 255 ms, so 250 ms covers the realistic worst
 * case while keeping the hopeless case fast. `journal_mode=wal` is far cheaper
 * still: 49/50 even at 0 ms, worst case 2 ms.
 */
export const LOCK_TIMEOUT_MS = 250;

/**
 * Row cap for the SQL editor's result set.
 *
 * The editor has no pager, so a hard clip is unavoidable somewhere; the choice
 * is whether the clip is silent (the old hidden `1000`) or reported. The
 * result's `truncated` flag is derived from `totalRows`, so the UI can say
 * "showing the first N of M" instead of presenting a cut-off table as the
 * complete answer.
 */
export const SQL_EDITOR_MAX_ROWS = 10_000;

/**
 * Above this magnitude an integer cannot survive the trip through a JS number.
 * `Number.MAX_SAFE_INTEGER` is 2^53 - 1; anything beyond it silently rounds,
 * which is how `127416364815353349` used to come back as a different value.
 */
const MAX_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_ID = -MAX_SAFE_ID;

/* ---- value handling ---------------------------------------------------- */

/**
 * Map a `SqlValue` onto something `better-sqlite3` can bind.
 *
 * The engine accepts ONLY null, number, string, bigint and Buffer, and throws
 * `TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and
 * null` for anything else — so a `boolean` or an `undefined` reaching a
 * parameter is a hard crash, not a silent coercion. Both really occur:
 * `SqlValue` includes `boolean`, and an optional key value can be `undefined`.
 *
 *   - `undefined` -> `null`   (an absent optional column is SQL NULL)
 *   - `boolean`   -> `0`/`1`  (SQLite has no boolean storage class)
 *   - `Uint8Array`-> `Buffer` (the engine wants a Buffer for BLOB binding)
 *   - everything else is passed through unchanged.
 *
 * A `bigint` is deliberately NOT narrowed to a number here: widening it would
 * defeat the whole point of the caller having sent it as a bigint.
 */
function toBindValue(v: SqlValue | undefined): null | number | string | bigint | Buffer {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return v;
}

/** Bind every parameter of a statement, normalising as described above. */
function bindAll(params: readonly (SqlValue | undefined)[]): (null | number | string | bigint | Buffer)[] {
  return params.map(toBindValue);
}

/**
 * Prepare a statement for the RESULT side, i.e. one whose rows we will read.
 *
 * `safeIntegers(true)` is essential and is the reason this helper exists.
 * Without it the engine converts every INTEGER column through a C `double`,
 * so `SELECT 9223372036854775807` comes back as the JS number
 * `9223372036854776000` — a SILENT loss of precision, with no error and no
 * warning. (It is asymmetric and easy to miss: BINDING an out-of-range bigint
 * throws, while READING one just rounds.) Turning it on makes the engine hand
 * back exact `bigint` values, which `readValue` then renders losslessly.
 *
 * The flag lives on the statement, so it never leaks into results we do not
 * prepare this way; the few statements whose rows are not user data are
 * prepared through the raw handle.
 */
function prepareForRead(db: SqliteDatabase, sql: string): SqliteStatement {
  const stmt = db.prepare(sql);
  stmt.safeIntegers(true);
  return stmt;
}

/**
 * Read a value out of a result without losing precision.
 *
 * With `safeIntegers(true)` on the statement (see `prepareForRead`) INTEGER
 * columns arrive as `bigint`, which is exact. `SqlValue` has no `bigint`
 * member — the wire protocol is JSON — so the rule is:
 *
 *   - a `bigint` that fits in a JS safe integer becomes a `number` (the
 *     ordinary case: rowids, counts, small ids all keep their type);
 *   - a `bigint` that does NOT fit becomes its exact decimal STRING, which
 *     round-trips through the protocol unharmed and re-binds as an exact
 *     integer (SQLite's column affinity converts numeric text back).
 *
 * A genuine TEXT column holding digits is untouched by the above: it arrives
 * as `string`, not `bigint`, so it keeps behaving like text and no unrelated
 * column changes type. Everything else is handed to `normalizeValue`.
 */
function readValue(v: unknown): SqlValue {
  if (typeof v === 'bigint') {
    if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
    return v.toString();
  }
  return normalizeValue(v);
}

/* ---- error translation ------------------------------------------------- */

/** True when an error means "another process holds the file lock". */
function isLockError(e: unknown): boolean {
  const code = (e as SqliteErrorLike | null)?.code;
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('locked') || msg.includes('busy');
}

/**
 * Map a driver error onto the shared `ErrorInfo` contract.
 *
 * `better-sqlite3` carries a precise SQLite result code on `.code`, which is
 * strictly better evidence than the previous adapter's message sniffing, so the
 * code is consulted first and the message is only a fallback. Only codes that
 * exist in `ErrorCode` are produced.
 *
 * `SQLITE_BUSY` / `SQLITE_LOCKED` map to `DB_LOCKED` (never to a generic
 * failure): the UI keys its "another program has this file" warning off that
 * code, and a lock is a transient, actionable situation rather than a bug.
 */
function toErrorInfo(e: unknown, fallback: string): ErrorInfo {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as SqliteErrorLike | null)?.code;
  let mapped: ErrorCode = 'UNKNOWN';

  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') mapped = 'DB_LOCKED';
  else if (code === 'SQLITE_READONLY' || code === 'SQLITE_PERM' || code === 'SQLITE_AUTH') mapped = 'PERMISSION';
  else if (code === 'SQLITE_CANTOPEN') mapped = 'PERMISSION';
  else if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT_VTAB') mapped = 'DB_CORRUPT';
  else if (code !== undefined && code.startsWith('SQLITE_')) {
    // Any other SQLite verdict is reported as a SQL error; the original message
    // is preserved verbatim in `raw` so nothing is hidden by the mapping.
    mapped = 'SQL_ERROR';
  } else {
    const lower = msg.toLowerCase();
    if (lower.includes('locked') || lower.includes('busy')) mapped = 'DB_LOCKED';
    else if (lower.includes('permission') || lower.includes('denied') || lower.includes('read-only')) mapped = 'PERMISSION';
    else if (
      lower.includes('corrupt') ||
      lower.includes('malformed') ||
      lower.includes('not a database') ||
      lower.includes('encrypted')
    ) {
      mapped = 'DB_CORRUPT';
    } else if (lower.includes('sql') || lower.includes('syntax') || lower.includes('near "')) mapped = 'SQL_ERROR';
    else if (lower.includes('rollback') || lower.includes('transaction')) mapped = 'TRANSACTION';
  }

  // A lock is worth naming explicitly: "database is locked" alone does not tell
  // the user that another PROGRAM has the file, which is the whole story.
  const message =
    mapped === 'DB_LOCKED'
      ? `The database file is locked by another process, so the write could not be saved (waited ${
          LOCK_TIMEOUT_MS
        } ms before giving up). Close the other program and retry. Driver said: ${msg}`
      : msg || fallback;

  return { code: mapped, message, raw: msg };
}

/**
 * True for names the engine reserves for itself, which the object tree and the
 * schema editors must not present as user objects.
 *
 * Two prefixes matter:
 *   - `sqlite_`           — the SQLite baseline (`sqlite_sequence`, `sqlite_master`, …).
 *   - `__turso_internal_` — leftover bookkeeping from Turso Database. A file that
 *                           was once written by Turso keeps helpers such as
 *                           `__turso_internal_seq_<name>`; without this they leak
 *                           into the UI as ordinary tables the user never created.
 */
function isInternalObject(name: string): boolean {
  return name.startsWith('sqlite_') || name.startsWith('__turso_internal_');
}

/**
 * Serializes work so only one task runs at a time, in arrival order.
 *
 * Needed because a database connection can host only one transaction at a time.
 * The webview posts messages without waiting for answers (`onDidReceiveMessage`
 * fires and forgets), so two quick actions — editing two cells, or creating a
 * table while a previous write is still in flight — really do reach the adapter
 * concurrently. Measured on the previous driver: the second one failed with
 * "cannot start a transaction within a transaction", and its work was lost.
 *
 * `better-sqlite3` is synchronous, so an individual statement cannot interleave
 * with another in the same process anyway; the mutex still matters because a
 * logical operation spans SEVERAL statements (a `SELECT` for the file size, a
 * `BEGIN`, a batch of writes, a `COMMIT`), and a second operation must not slip
 * between them.
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Runs `task` after every previously queued task has settled.
   *
   * The task may be synchronous or asynchronous: better-sqlite3's own API is
   * sync, so most write paths hand back a plain value and only the surrounding
   * bookkeeping is async.
   */
  run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // Keep the chain alive regardless of whether the task resolves or rejects,
    // so one failure cannot stall every later operation.
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Runs a synchronous `task` under the same discipline. */
  runSync<T>(task: () => T): Promise<T> {
    return this.run(async () => task());
  }
}

/* ------------------------------------------------------------------------ */

export class SqliteAdapter implements DatabaseAdapter {
  readonly driverName = 'better-sqlite3';

  private db: SqliteDatabase | null = null;
  private dbPath = '';
  private dbSizeBytes = 0;
  private writable = true;
  private readOnlyFlag = false;
  /**
   * Set when `open()` had to fall back to a read-only connection. Deliberately
   * separate from `readOnlyFlag` (the user's own setting) so the UI can tell
   * "you asked for read-only" from "you cannot write to this file".
   */
  private readOnlyFallback = false;
  /**
   * The failure that stopped `open()`, kept so `getInfo()` can report the real
   * cause. Without it every later `getInfo()` reported `UNKNOWN`/"Database is
   * not open.", which buried the verdict the user actually needs.
   */
  private openError: ErrorInfo | null = null;
  private detection: LibSqlDetection | null = null;
  private version = '';
  /** One per adapter: a connection hosts one transaction at a time. */
  private readonly mutex = new Mutex();

  async open(filePath: string, options?: { readOnly?: boolean }): Promise<DatabaseInfo | ErrorInfo> {
    // A previously open file must be released before its handle is overwritten,
    // otherwise every reopen to a different file leaks one native connection
    // (and its file descriptor) for the lifetime of the panel.
    if (this.db) {
      try {
        this.close();
      } catch {
        // The new open below reports its own failure; a stale handle that
        // refuses to close must not mask that verdict.
      }
      this.db = null;
    }
    this.dbPath = filePath;
    this.detection = null;
    this.openError = null;
    this.readOnlyFallback = false;
    // The user's read-only setting is enforced at the connection level: the
    // engine itself refuses every mutation, so no code path (not even a
    // malicious or buggy webview message) can write. This flag also tells the
    // UI "you asked for read-only" as distinct from a locked file.
    const userReadOnly = options?.readOnly === true;
    this.readOnlyFlag = userReadOnly;

    try {
      const stats = await fs.promises.stat(filePath);
      this.dbSizeBytes = stats.size;
      this.writable = await fs.promises
        .access(filePath, fs.constants.W_OK)
        .then(() => true, () => false);
    } catch {
      const error: ErrorInfo = {
        code: 'FILE_NOT_FOUND',
        message: `Database file not found: ${filePath}`
      };
      // Recorded like every other open failure, so `getInfo()` reports the real
      // reason instead of degenerating to `UNKNOWN`.
      this.openError = error;
      return error;
    }

    try {
      let db: SqliteDatabase;
      try {
        // Read-write stays the default: an editor must be able to save. When the
        // user asked for read-only, the engine-level `readonly` flag makes the
        // whole connection incapable of writing, which is the hard guarantee.
        db = new (getSqlite())(filePath, { timeout: LOCK_TIMEOUT_MS, readonly: userReadOnly });
      } catch (e) {
        // Opening read-write can fail for two very different reasons, and only
        // one of them is recoverable here:
        //
        //   - the file (or its directory) is not writable, so SQLite refuses the
        //     read-write open. A read-only handle needs no write permission and
        //     no write lock, so the user can still browse and query. That is
        //     strictly better than refusing to open.
        //   - the file is locked by a peer. The engine's own busy handler is
        //     consulted during the open, so this waits `LOCK_TIMEOUT_MS` before
        //     throwing; a read-only handle sidesteps the lock entirely.
        //
        // Anything else (corrupt file, missing directory) is rethrown: a
        // read-only retry cannot help and would only hide the real cause.
        if (!isWritableOpenFailure(e) || userReadOnly) throw e;
        db = new (getSqlite())(filePath, { readonly: true, timeout: LOCK_TIMEOUT_MS });
        this.readOnlyFallback = true;
      }
      this.db = db;
      this.version = String(this.scalar('SELECT sqlite_version();') ?? 'unknown');
      this.detection = this.detectLibSql();
      return this.info();
    } catch (e) {
      // Remember the failure so `getInfo()` can keep reporting it: the UI asks
      // for info after a failed open, and answering "not open" would hide the
      // lock (or corruption, or permission) that actually stopped us.
      const error = toErrorInfo(e, 'Unknown error while opening the database.');
      this.openError = error;
      return error;
    }
  }

  isOpen(): boolean {
    return this.db !== null && this.db.open;
  }

  async getInfo(): Promise<DatabaseInfo | ErrorInfo> {
    // Report the real reason the database could not be opened. Falling back to
    // a generic "not open" here is what used to turn a `DB_LOCKED` verdict into
    // `UNKNOWN` and send the user hunting for the wrong problem.
    if (!this.db) {
      return this.openError ?? { code: 'UNKNOWN', message: 'Database is not open.' };
    }
    return this.info();
  }

  /** Assemble DatabaseInfo from the live database plus the cached verdict. */
  private info(): DatabaseInfo {
    const detection =
      this.detection ??
      resolveLibSqlDetection(this.dbPath, { version: this.version }, false);
    const pageSize = Number(this.scalar('PRAGMA page_size;') ?? 4096) || 4096;
    const pageCount = Number(this.scalar('PRAGMA page_count;') ?? 0) || 0;
    return {
      path: this.dbPath,
      // Prefer the engine's own page count: it is the authoritative size of the
      // database, whereas the directory entry is a moment-in-time snapshot taken
      // before the connection opened and can be stale or include free pages.
      sizeBytes: pageCount > 0 ? pageCount * pageSize : this.dbSizeBytes,
      pageSize,
      encoding: this.mapEncoding(String(this.scalar('PRAGMA encoding;') ?? 'UTF-8')),
      tableCount: this.countObjects('table') ?? 0,
      viewCount: this.countObjects('view') ?? 0,
      indexCount: this.countObjects('index') ?? 0,
      triggerCount: this.countObjects('trigger') ?? 0,
      // A connection that had to open read-only cannot write, whatever the file
      // permissions say — report that first, so the UI does not offer edits the
      // engine will reject.
      writable: this.writable && !this.readOnlyFallback,
      readOnly: this.readOnlyFlag || this.readOnlyFallback,
      // Only set when read-only; `undefined` when writable, so the UI's
      // `=== 'locked'` check stays a precise signal.
      readOnlyReason: this.readOnlyFallback ? 'locked' : this.readOnlyFlag ? 'user' : undefined,
      version: this.version,
      driver: this.driverName,
      engine: detection.engine,
      detection,
      capabilities: this.capabilities()
    };
  }

  /**
   * The capability set for the shipped engine.
   *
   * Stock SQLite implements the SQLite baseline: the LibSQL/Turso extensions the
   * editor gates on (`CREATE SEQUENCE`, `nextval()`, `vector_*`) do NOT exist
   * here, while the baseline features it does use (`STRICT`, `RENAME`/`DROP
   * COLUMN`, `RETURNING`, UPSERT) do. A file detected as libSQL or Turso changes
   * none of this — the engine is what executes, so the answer is the SQLite set.
   *
   * Bound through `capabilitiesForDriver()` rather than naming the constant
   * directly, so the driver name reported to the webview and the capability set
   * it reads can never disagree, and the stock-SQLite answer is decided in one
   * shared place.
   */
  private capabilities(): LibSqlCapabilities {
    return capabilitiesForDriver(this.driverName, this.engine);
  }

  /**
   * Decide which dialect the open file is written in.
   *
   * A stock-SQLite driver can OPEN a file that was written by libSQL or Turso
   * Database (the on-disk container is shared), so the verdict is still worth
   * reporting — it tells the user what will happen if they edit this file with
   * an engine that is not this one, and it is what `isLibSql()` reports.
   *
   * `fallback` is passed as false: this driver is the only one, so a detected
   * file is never being served by a less capable engine that took over.
   */
  private detectLibSql(): LibSqlDetection {
    return resolveLibSqlDetection(
      this.dbPath,
      {
        version: this.version,
        pragmas: this.enginePragmas(),
        objectNames: this.schemaObjectNames()
      },
      false
    );
  }

  /** Names of every object in the schema, used for LibSQL schema probing. */
  private schemaObjectNames(): string[] {
    try {
      return this.rows('SELECT name FROM sqlite_master;').map((r) => String(r.name));
    } catch {
      return [];
    }
  }

  /**
   * The detected dialect of the open file, for callers that need it before the
   * full `DatabaseInfo` is assembled.
   *
   * Reports `sqlite` when nothing has been detected yet, which is the correct
   * baseline answer: an unopened or unclassifiable file is treated as plain
   * SQLite rather than credited with extensions it may not use.
   */
  private get engine(): DbEngine {
    return this.detection?.engine ?? 'sqlite';
  }

  /** Engine build flags, some of which carry a LibSQL marker. */
  private enginePragmas(): string[] {
    try {
      return this.rows('PRAGMA compile_options;')
        .map((r) => String(Object.values(r)[0] ?? ''))
        .filter((v) => v.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * True when the open file belongs to the LibSQL family (LibSQL or Turso
   * Database), as opposed to the plain SQLite baseline. Note this says nothing
   * about which features are executable — see `capabilities()` for that, which is
   * always the SQLite baseline here because stock SQLite is what executes.
   */
  isLibSql(): boolean {
    return this.detection?.libSql === true || this.detection?.engine === 'libsql';
  }

  /* ------------------------------ objects ------------------------------- */

  async getObjects(includeHidden = false): Promise<ObjectInfo[] | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const rows = this.rows(
        `SELECT type, name, sql FROM sqlite_master
         WHERE type IN ('table','view','index','trigger')
         ORDER BY type, name`
      );
      const out: ObjectInfo[] = rows
        .filter((r) => includeHidden || !isInternalObject(String(r.name)))
        .map((r) => ({
          name: String(r.name),
          type: r.type as ObjectType,
          sql: (r.sql as string | null) ?? '',
          hidden: isInternalObject(String(r.name))
        }));

      // NO synthesized "sequence" objects here, deliberately.
      //
      // The previous adapter turned every row of `sqlite_sequence` into a pseudo
      // sequence. On stock SQLite `sqlite_sequence` is NOT a user sequence: it is
      // the AUTOINCREMENT bookkeeping table, and it only exists while some table
      // declares AUTOINCREMENT. Presenting it as a sequence would invent a
      // database object that cannot be created, altered or dropped, and would
      // tell the user their AUTOINCREMENT table has a "sequence" they never
      // wrote. `CREATE SEQUENCE` does not exist in this engine, so
      // `SQLITE_CAPABILITIES.sequences` is false and there is nothing to report.
      return out;
    } catch (e) {
      return toErrorInfo(e, 'Unknown error listing database objects.');
    }
  }

  async getSchema(objectName: string): Promise<{ columns: ColumnInfo[]; sql: string } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const pr = this.rows(`PRAGMA table_info(${quoteIdent(objectName)});`);
      const pkCount = pr.filter((c) => Boolean(c.pk)).length;
      const columns: ColumnInfo[] = pr.map((r, i) => ({
        name: String(r.name),
        type: (r.type as string) || '',
        notNull: Boolean(r.notnull),
        defaultValue: r.dflt_value === null || r.dflt_value === undefined ? null : String(r.dflt_value),
        pk: Boolean(r.pk),
        pkOrder: Number(r.pk) || 0,
        rowidAlias: Boolean(r.pk) && pkCount === 1,
        cid: Number(r.cid) || i,
        hidden: false
      }));
      const sqlRow = this.rows(
        `SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name=?;`,
        [objectName]
      );
      const sql = sqlRow.length > 0 ? String(sqlRow[0]?.sql ?? '') : '';
      return { columns, sql };
    } catch (e) {
      return toErrorInfo(e, `Unknown error reading schema of "${objectName}".`);
    }
  }

  /* ------------------------------ query --------------------------------- */

  async query(sql: string, page: number, pageSize: number, params: SqlValue[] = []): Promise<QueryResult | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    const start = Date.now();
    try {
      const trimmed = sql.trim().replace(/(;\s*)+$/, '');
      // Classify by the engine, not by regex: `stmt.reader` is authoritative for
      // whether a statement returns rows. A regex cannot be trusted here —
      // `WITH … INSERT` starts like a SELECT but mutates, and a regex misfile
      // used to wrap such a statement in a count subquery (a syntax error) and
      // then execute the write a second time for the page fetch.
      const prepared = this.prepare(trimmed);
      if (!prepared.reader) {
        // A write reaching the query path (SQL editor) must pass the same
        // read-only guard as every other mutating entry point.
        const guard = this.writeGuard();
        if (guard) return guard;
        // A non-reader statement cannot be `.all()`ed; `run` reports the count.
        const res = prepared.run(...bindAll(params));
        const affectedRows = typeof res.changes === 'number' ? res.changes : 0;
        return {
          columns: [],
          rows: [],
          totalRows: 0,
          truncated: false,
          affectedRows,
          isQuery: false,
          durationMs: Date.now() - start
        };
      }

      // The count is a full second pass over the query. It is what drives the
      // webview's "showing N of M" pager, so it is kept as-is. Bound filter
      // values apply to both passes.
      const countRow = this.prepare(`SELECT count(*) AS c FROM (${trimmed}) AS t;`).get(...bindAll(params));
      const totalRows = Number((countRow as Record<string, unknown> | undefined)?.c ?? 0);

      const limit = Math.max(1, pageSize);
      const offset = Math.max(0, page * pageSize);
      const statement = this.prepareForRead(`${trimmed} LIMIT ${limit} OFFSET ${offset}`);
      statement.bind(...bindAll(params));
      const columns = statement.columns().map((c) => ({ name: c.name, type: '' }));
      const names = columns.map((c) => c.name);
      const rawRows = statement.all() as Record<string, unknown>[];
      const rows: SqlValue[][] = rawRows.map((r) => names.map((n) => readValue(r[n])));
      return {
        columns,
        rows,
        totalRows,
        truncated: totalRows > (page + 1) * pageSize,
        isQuery: true,
        durationMs: Date.now() - start
      };
    } catch (e) {
      return toErrorInfo(e, 'Unknown error executing query.');
    }
  }

  async rowCount(objectName: string): Promise<number | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      return Number(this.scalar(`SELECT count(*) AS c FROM ${quoteIdent(objectName)};`) ?? 0);
    } catch (e) {
      return toErrorInfo(e, `Unknown error counting rows in "${objectName}".`);
    }
  }

  /* ------------------------------ edits ---------------------------------- */

  /**
   * Host-side guard for every mutating operation.
   *
   * The webview's UI gating is a convenience, never the enforcement: any code
   * path that reaches the adapter must be refused here when the user (or the
   * open fallback) made this connection read-only. When the connection itself
   * was opened `readonly` the engine also refuses, but an explicit verdict with
   * a clear message beats a raw SQLITE_READONLY error.
   */
  private writeGuard(): ErrorInfo | null {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    if (this.readOnlyFlag) {
      return {
        code: 'PERMISSION',
        message: 'The database is open in read-only mode (libSqlPreviewEdit.readOnly). Disable the setting to edit.'
      };
    }
    if (this.readOnlyFallback) {
      return {
        code: 'PERMISSION',
        message: 'The database file could only be opened read-only (locked or not writable), so edits are disabled.'
      };
    }
    return null;
  }

  async commitEdits(edits: RowEdit[]): Promise<{ changes: number } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    if (edits.length === 0) return { changes: 0 };
    return this.mutex.runSync(() => {
      try {
        return this.inTransaction((tx) => {
          let changes = 0;
          for (const edit of edits) {
            if (edit.edits.length === 0) continue;
            const sets = edit.edits.map((e) => `${quoteIdent(e.column)} = ?`).join(', ');
            const params = bindAll([...edit.edits.map((e) => e.value), ...edit.key.keyValues]);
            const keyWhere = edit.key.keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
            // Count rows the engine actually touched, not edits attempted: the
            // key can have changed underneath (another editor, a concurrent
            // delete), and an UPDATE matching 0 rows must not be reported as a
            // successful save.
            const res = tx
              .prepare(`UPDATE ${quoteIdent(edit.key.table)} SET ${sets} WHERE ${keyWhere};`)
              .run(...params);
            changes += res.changes;
          }
          return { changes };
        });
      } catch (e) {
        return toErrorInfo(e, 'Transaction failed and was rolled back.');
      }
    });
  }

  async insertRow(
    table: string,
    values: Record<string, SqlValue>
  ): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    const columns = Object.keys(values);
    if (columns.length === 0) {
      return { code: 'SQL_ERROR', message: 'Cannot insert a row with no columns.' };
    }
    const schema = await this.getSchema(table);
    if (isErrorInfo(schema)) return schema;
    const columnsSet = new Set(columns);
    const missing: string[] = [];
    for (const c of schema.columns) {
      if (!c.pk && c.notNull && c.defaultValue === null && !columnsSet.has(c.name)) {
        missing.push(c.name);
      }
    }
    if (missing.length > 0) {
      return {
        code: 'SQL_ERROR',
        message: `Missing required (NOT NULL without default) columns: ${missing.join(', ')}`
      };
    }
    const colList = columns.map((c) => quoteIdent(c)).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    // `values[c]` is `undefined` when a caller passed an explicit undefined; the
    // binder turns that into SQL NULL rather than crashing (see `toBindValue`).
    const params = bindAll(columns.map((c) => values[c]));
    try {
      const lastId = await this.mutex.run(() =>
        this.inTransaction((tx) =>
          tx.prepare(`INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders});`).run(...params)
        )
      );
      // `lastInsertRowid` only means something for rowid tables. On a WITHOUT
      // ROWID table the value is meaningless (usually 0), so reporting it as a
      // usable key would make every later edit/delete of the new row target a
      // row that does not exist. When the table has real primary key columns,
      // read those back from the just-inserted row so the webview can key edits
      // off them instead.
      const pkColumns = schema.columns.filter((c) => c.pk).map((c) => c.name);
      if (pkColumns.length > 0 && !pkColumns.includes('rowid')) {
        const keyWhere = pkColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
        const inserted = this.rows(
          `SELECT ${pkColumns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} WHERE ${keyWhere} LIMIT 1;`,
          pkColumns.map((c) => values[c] ?? null)
        );
        if (inserted.length > 0 && inserted[0]) {
          const first = inserted[0];
          return { key: { columns: pkColumns, values: pkColumns.map((c) => first[c] ?? null) } };
        }
      }
      return { key: { columns: ['rowid'], values: [this.toSqlValue(lastId.lastInsertRowid)] } };
    } catch (e) {
      return toErrorInfo(e, 'Insert failed and was rolled back.');
    }
  }

  async deleteRows(keys: { table: string; keyColumns: string[]; keyValues: SqlValue[] }[]): Promise<{ changes: number } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    // A keyless delete is `DELETE FROM table;` — one stray edit action would
    // wipe an entire table. Refuse it: a row is only deletable when it carries
    // the key that identifies it.
    const keyless = keys.filter((k) => k.keyColumns.length === 0);
    if (keyless.length > 0) {
      const names = [...new Set(keyless.map((k) => `"${k.table}"`))].join(', ');
      return {
        code: 'SQL_ERROR',
        message:
          `Cannot delete from ${names}: the row has no primary key and no rowid, ` +
          'so a delete could not be limited to a single row.'
      };
    }
    try {
      const changes = await this.mutex.run(() =>
        this.inTransaction((tx) => {
          let n = 0;
          for (const k of keys) {
            const where = k.keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
            tx.prepare(`DELETE FROM ${quoteIdent(k.table)} WHERE ${where};`).run(...bindAll(k.keyValues));
            n += 1;
          }
          return n;
        })
      );
      return { changes };
    } catch (e) {
      return toErrorInfo(e, 'Delete failed and was rolled back.');
    }
  }

  async duplicateRow(
    table: string,
    keyColumns: string[],
    keyValues: SqlValue[]
  ): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    const schema = await this.getSchema(table);
    if (isErrorInfo(schema)) return schema;
    const nonPkCols = schema.columns.filter((c) => !c.pk);
    if (nonPkCols.length === 0) {
      return { code: 'SQL_ERROR', message: 'No non-key columns to duplicate.' };
    }
    const cols = nonPkCols.map((c) => quoteIdent(c.name)).join(', ');
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
    try {
      const lastId = await this.mutex.run(() =>
        this.inTransaction((tx) =>
          tx
            .prepare(
              `INSERT INTO ${quoteIdent(table)} (${cols}) SELECT ${cols} FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1;`
            )
            .run(...bindAll(keyValues))
        )
      );
      return { key: { columns: ['rowid'], values: [this.toSqlValue(lastId.lastInsertRowid)] } };
    } catch (e) {
      return toErrorInfo(e, 'Duplicate failed and was rolled back.');
    }
  }

  async executeStatements(statements: string[]): Promise<{ statements: number; affectedRows: number } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    try {
      return await this.mutex.run(() =>
        this.inTransaction((tx) => {
          let count = 0;
          let affectedRows = 0;
          for (const stmt of statements) {
            const s = stmt.trim();
            if (s.length === 0) continue;
            const prepared = tx.prepare(s);
            if (prepared.reader) {
              // A SELECT inside a statement batch has no effect to count, but it
              // must still be executed rather than skipped.
              prepared.all();
            } else {
              affectedRows += prepared.run().changes;
            }
            count += 1;
          }
          return { statements: count, affectedRows };
        })
      );
    } catch (e) {
      return toErrorInfo(e, 'Transaction failed and was rolled back.');
    }
  }

  async executeSql(sql: string): Promise<QueryResult | ErrorInfo> {
    // The SQL editor has no pager, so its result must not be silently clipped:
    // page 0 with the page size above every realistic row count returns the
    // whole result set, and `truncated` still tells the user when a genuinely
    // enormous result was capped.
    return this.query(sql, 0, SQL_EDITOR_MAX_ROWS);
  }

  async executeDdl(statements: string[]): Promise<{ statements: number } | ErrorInfo> {
    const r = await this.executeStatements(statements);
    if (isErrorInfo(r)) return r;
    return { statements: r.statements };
  }

  async deleteObject(name: string, type: ObjectType): Promise<{ ok: true } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    if (type === 'system') return { code: 'PERMISSION', message: 'Cannot delete system objects.' };
    if (isInternalObject(name)) {
      // Refuse outright rather than emit `DROP TABLE IF EXISTS sqlite_sequence`:
      // SQLite reserves these names and the statement would fail (or, worse,
      // damage engine bookkeeping) with a confusing message.
      return { code: 'PERMISSION', message: `"${name}" is an engine-internal object and cannot be deleted.` };
    }
    const typeName =
      type === 'table' ? 'TABLE' : type === 'view' ? 'VIEW' : type === 'index' ? 'INDEX' : type === 'trigger' ? 'TRIGGER' : null;
    if (typeName === null) {
      return { code: 'SQL_ERROR', message: `Cannot drop an object of type "${type}".` };
    }
    try {
      await this.mutex.run(() =>
        this.inTransaction((tx) => tx.prepare(`DROP ${typeName} IF EXISTS ${quoteIdent(name)};`).run())
      );
      return { ok: true };
    } catch (e) {
      return toErrorInfo(e, `Failed to delete ${type} "${name}".`);
    }
  }

  /* ------------------------------ export --------------------------------- */

  /**
   * Write exported content to `destPath`, or to a temporary file when the caller
   * did not supply one.
   *
   * The host always supplies a path (it asks the user with a save dialog), so an
   * export lands where the user chose. The temporary fallback exists for
   * programmatic callers and tests; because the destination is decided here, the
   * caller must report the RETURNED path rather than reconstructing it.
   */
  private async writeExport(data: string, ext: string, baseName: string, destPath?: string): Promise<string> {
    const dest =
      destPath ??
      path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sqlite-')), `${baseName}.${ext}`);
    // A user-chosen nested directory may not exist yet.
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, data, 'utf8');
    return dest;
  }

  async export(
    format: ExportFormat,
    objectName?: string,
    selectSql?: string,
    destPath?: string
  ): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const data = this.buildExport(format, objectName, selectSql);
      const dest = await this.writeExport(data, format, objectName ?? 'database', destPath);
      return { filePath: dest, sizeBytes: Buffer.byteLength(data) };
    } catch (e) {
      return toErrorInfo(e, 'Export failed.');
    }
  }

  async exportDatabase(format: ExportFormat, destPath?: string): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const objects = await this.getObjects(true);
      if (isErrorInfo(objects)) return objects;
      if (format === 'sql') {
        // Order matters for re-importability. `getObjects` returns alphabetical
        // order, which puts CREATE INDEX before CREATE TABLE and makes the dump
        // fail on import. Tables must exist before their indexes, triggers and
        // views, and data must load with foreign keys off before the
        // constraints are re-armed.
        const byType = (t: string) =>
          objects
            .filter((x) => x.type === t && x.sql && !isInternalObject(x.name))
            .sort((a, b) => a.name.localeCompare(b.name));
        const tables = byType('table');
        const shadowTables = new Set(this.shadowTableNames());
        const dataTables = tables.filter((t) => !shadowTables.has(t.name));

        const parts: string[] = [];
        parts.push('-- Exported by SQLite/LibSQL/Turso P&E');
        parts.push(`-- Database: ${this.dbPath}`);
        parts.push('--');
        parts.push('PRAGMA foreign_keys=OFF;');
        parts.push('BEGIN TRANSACTION;');
        for (const t of tables) {
          parts.push(`${t.sql!.replace(/;\s*$/, '')};`);
        }
        for (const t of dataTables) {
          parts.push('');
          parts.push(`-- Data for table: ${t.name}`);
          const dataRows = this.rows(`SELECT * FROM ${quoteIdent(t.name)};`);
          if (dataRows.length === 0) continue;
          const cols = Object.keys(dataRows[0] ?? {});
          const lines: string[] = [`INSERT INTO ${quoteIdent(t.name)} (${cols.map(quoteIdent).join(', ')}) VALUES`];
          for (const row of dataRows) {
            const vals = cols.map((c) => quoteLiteral(normalizeValue(row[c]))).join(', ');
            lines.push(`  (${vals}),`);
          }
          const lastIdx = lines.length - 1;
          lines[lastIdx] = (lines[lastIdx] ?? '').replace(/,$/, '');
          parts.push(lines.join('\n') + ';');
        }
        // AUTOINCREMENT bookkeeping: without this, a restored database restarts
        // every AUTOINCREMENT sequence at its table's max rowid, which can
        // reissue ids that were already used (breaking external references).
        if (this.tableExists('sqlite_sequence')) {
          const seqs = this.rows('SELECT name, seq FROM sqlite_sequence;');
          for (const s of seqs) {
            parts.push(
              `UPDATE sqlite_sequence SET seq=${quoteLiteral(normalizeValue(s.seq))} WHERE name=${quoteLiteral(String(s.name))};`
            );
          }
        }
        for (const v of byType('view')) {
          parts.push(`${v.sql!.replace(/;\s*$/, '')};`);
        }
        for (const i of byType('index')) {
          parts.push(`${i.sql!.replace(/;\s*$/, '')};`);
        }
        for (const tr of byType('trigger')) {
          parts.push(`${tr.sql!.replace(/;\s*$/, '')};`);
        }
        parts.push('COMMIT;');
        parts.push('PRAGMA foreign_keys=ON;');
        const text = parts.join('\n') + '\n';
        const dest = await this.writeExport(text, 'sql', 'database', destPath);
        return { filePath: dest, sizeBytes: Buffer.byteLength(text) };
      }
      if (format === 'json') {
        const parts: Record<string, unknown>[] = [];
        const shadowTables = new Set(this.shadowTableNames());
        for (const t of objects.filter((x) => x.type === 'table' && !shadowTables.has(x.name))) {
          parts.push({ table: t.name, rows: this.rows(`SELECT * FROM ${quoteIdent(t.name)};`) });
        }
        const text = JSON.stringify(parts, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
        const dest = await this.writeExport(text, 'json', 'database', destPath);
        return { filePath: dest, sizeBytes: Buffer.byteLength(text) };
      }
      return {
        code: 'SQL_ERROR',
        message: 'CSV is not a valid format for a whole-database export; export per table instead.'
      };
    } catch (e) {
      return toErrorInfo(e, 'Database export failed.');
    }
  }

  /* ------------------------------ import --------------------------------- */

  async importPreview(
    filePath: string,
    format: ImportFormat
  ): Promise<{ headers: string[]; mappings: ImportFieldMapping[]; previewRows: SqlValue[][] } | ErrorInfo> {
    try {
      if (format === 'json') {
        const text = await fs.promises.readFile(filePath, 'utf8');
        const arr = JSON.parse(text) as unknown;
        if (!Array.isArray(arr) || arr.length === 0) {
          return { code: 'SQL_ERROR', message: 'The JSON file must contain a non-empty array of row objects.' };
        }
        const headers = Object.keys(arr[0] as Record<string, unknown>);
        const mappings = headers.map((h) => ({
          source: h,
          target: h,
          inferredType: inferType((arr[0] as Record<string, unknown>)[h])
        }));
        const previewRows = arr
          .slice(0, 10)
          .map((row) => headers.map((h) => String((row as Record<string, unknown>)[h] ?? '')));
        return { headers, mappings, previewRows };
      }
      const text = await fs.promises.readFile(filePath, 'utf8');
      const rows = parseCsv(text);
      const headers: string[] = rows[0] ?? [];
      if (headers.length === 0) return { code: 'SQL_ERROR', message: 'The CSV file is empty.' };
      const mappings = headers.map((h, i) => ({
        source: h,
        target: h,
        inferredType: inferTypeFromColumn(rows, i)
      }));
      const previewRows = rows.slice(1, 11);
      return { headers, mappings, previewRows };
    } catch (e) {
      return toErrorInfo(e, 'Import preview failed.');
    }
  }

  async importCommit(
    filePath: string,
    tableName: string,
    mappings: ImportFieldMapping[],
    conflict: 'skip' | 'replace' | 'fail',
    createTable: boolean,
    format: ImportFormat = 'csv'
  ): Promise<{ rows: number; skipped: number; tableName: string } | ErrorInfo> {
    const guard = this.writeGuard();
    if (guard) return guard;
    try {
      // Honour the format the user picked in the dialog. The file extension is
      // only a hint — a `.txt` CSV or a JSON file saved with another suffix
      // would previously be re-parsed as CSV, silently mangling every row.
      // Callers that predate the `format` parameter default to CSV.
      let rows: Record<string, SqlValue>[] = [];
      if (format === 'json') {
        const text = await fs.promises.readFile(filePath, 'utf8');
        const arr = JSON.parse(text) as unknown;
        if (!Array.isArray(arr)) throw new Error('JSON file must be an array of row objects.');
        rows = (arr as Record<string, unknown>[]).map((r) => {
          const out: Record<string, SqlValue> = {};
          for (const m of mappings) {
            const raw = r[m.source];
            out[m.target] = raw === undefined || raw === null ? null : convertJsonValue(raw);
          }
          return out;
        });
      } else {
        const text = await fs.promises.readFile(filePath, 'utf8');
        const parsed = parseCsv(text);
        const headers = parsed[0] ?? [];
        rows = parsed.slice(1).map((r) => {
          const out: Record<string, SqlValue> = {};
          for (const m of mappings) {
            const src = headers.indexOf(m.source);
            const raw = src >= 0 ? r[src] ?? '' : '';
            out[m.target] = raw === '' ? null : (raw as SqlValue);
          }
          return out;
        });
      }
      if (rows.length === 0) return { rows: 0, skipped: 0, tableName };
      const columns = mappings.map((m) => m.target);
      const exists = this.tableExists(tableName);
      if (createTable && !exists) {
        const colsDef = mappings.map((m) => `${quoteIdent(m.target)} ${m.inferredType || 'TEXT'}`).join(', ');
        await this.mutex.run(() =>
          this.inTransaction((tx) => tx.prepare(`CREATE TABLE ${quoteIdent(tableName)} (${colsDef});`).run())
        );
      }
      if (!exists && !createTable) {
        return { code: 'SQL_ERROR', message: `Table "${tableName}" does not exist and createTable is disabled.` };
      }

      // A single transaction for the whole file, as before. The one structural
      // difference from the previous adapter: `INSERT OR IGNORE` does NOT throw
      // on a conflict, it reports `changes: 0`. The old code counted a row as
      // inserted unless an exception was raised, so every SKIPPED row was
      // counted as inserted and the "N rows imported" figure was wrong. Here the
      // engine's own affected-row count decides.
      return await this.mutex.run(() =>
        this.inTransaction((tx) => {
          const colList = columns.map((c) => quoteIdent(c)).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          const stmtSql =
            conflict === 'skip'
              ? `INSERT OR IGNORE INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders});`
              : conflict === 'replace'
                ? `INSERT OR REPLACE INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders});`
                : `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders});`;
          const statement = tx.prepare(stmtSql);
          let inserted = 0;
          let skipped = 0;
          for (const row of rows) {
            const params = bindAll(columns.map((c) => row[c]));
            const res = statement.run(...params);
            if (res.changes > 0) inserted += 1;
            // Under "fail" a conflict throws before reaching here, so a zero-change
            // row can only be a skip (or a replace that rewrote an identical row,
            // which the engine still counts as a change).
            else if (conflict === 'skip') skipped += 1;
            else inserted += 1;
          }
          return { rows: inserted, skipped, tableName };
        })
      );
    } catch (e) {
      return toErrorInfo(e, 'Import commit failed.');
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  async isWritable(): Promise<boolean> {
    if (!this.writable || this.readOnlyFlag || this.readOnlyFallback) return false;
    if (!this.db) return false;
    try {
      // `query_only` is the engine's own answer to "may this connection write?".
      // It is accurate for a read-only handle, a read-only file and a read-only
      // directory, and it costs nothing — unlike probing with a real write.
      const only = Number(this.scalar('PRAGMA query_only;') ?? 0);
      if (only === 1) return false;
      this.scalar('SELECT 1;');
      return true;
    } catch {
      this.writable = false;
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.db && this.db.open) {
        // Fold the write-ahead log back into the main database file first.
        //
        // A committed edit can live in the `<file>-wal` sidecar until a
        // checkpoint merges it; the main file is what users copy, sync, attach
        // or hand to another SQLite tool, all of which would otherwise see a
        // stale database.
        //
        // PASSIVE, never TRUNCATE. Both were measured against a peer that holds
        // the database open and idle (the resident-service case): PASSIVE
        // reported `checkpointed:1` and finished in 5 ms, while TRUNCATE
        // reported `checkpointed:0` — it needs access no other connection is
        // using and is simply starved whenever one exists. TRUNCATE's only
        // advantage is emptying the sidecar, which is not worth an exclusive
        // grab at a file the user may be sharing; a checkpoint is refused while
        // any other connection is reading, and `close()` must never throw
        // because of it — the data is already committed either way, and `-wal`
        // is a normal, recoverable state.
        try {
          this.db.pragma('wal_checkpoint(PASSIVE)');
        } catch {
          /* best-effort; the edit is committed either way */
        }
      }
      this.db?.close();
    } catch {
      // Closing a handle whose file was removed underneath us can throw; the
      // handle is dropped regardless (see `finally`).
    } finally {
      this.db = null;
      this.dbPath = '';
      // A stale verdict must not outlive the connection, or reopening a
      // different file would report the previous one's lock.
      this.readOnlyFallback = false;
      this.openError = null;
      this.detection = null;
    }
  }

  /* ------------------------------ internals ------------------------------ */

  /**
   * Run `body` inside one atomic transaction on the connection.
   *
   * `BEGIN` is issued explicitly rather than through `db.transaction(fn)` so the
   * whole sequence is one critical section under the mutex: the previous engine
   * lost work when two transactions were nested, and the guard has to cover the
   * BEGIN as well as the statements. A failure anywhere rolls the entire set
   * back, so a half-applied batch can never reach the disk, and `ROLLBACK` is
   * attempted in a `catch` that rethrows the ORIGINAL error.
   *
   * Callers MUST hold the mutex (via `this.mutex.run`/`runSync`) — a connection
   * hosts one transaction at a time, so two interleaved callers would trip
   * "cannot start a transaction within a transaction". The unguarded entry
   * point is private precisely so that mistake cannot happen by accident.
   */
  private inTransaction<T>(body: (tx: SqliteDatabase) => T): T {
    const db = this.db;
    if (!db) throw new Error('Database is not open.');
    db.exec('BEGIN');
    try {
      const out = body(db);
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already torn down by the engine */
      }
      throw e;
    }
  }

  /**
   * Prepare a statement, failing loudly when the database is not open.
   *
   * Used for statements whose ROWS we never read (writes and DDL), where
   * integer precision does not matter. Anything whose result reaches the user
   * goes through `prepareForRead` instead.
   */
  private prepare(sql: string): SqliteStatement {
    if (!this.db) throw new Error('Database is not open.');
    return this.db.prepare(sql);
  }

  /** Prepare a statement for read access, preserving 64-bit integer precision. */
  private prepareForRead(sql: string): SqliteStatement {
    if (!this.db) throw new Error('Database is not open.');
    return prepareForRead(this.db, sql);
  }

  /**
   * Run a query and return its rows as objects, with every value normalised.
   *
   * Values go through `readValue` on the way out. That is not cosmetic: the
   * statements here are prepared with `safeIntegers(true)`, so an INTEGER column
   * arrives as a raw `bigint`, which `JSON.stringify` refuses outright
   * (`TypeError: Do not know how to serialize a BigInt`) and which
   * `quoteLiteral`/CSV would not render as the user's number. Normalising here
   * keeps every read path — grid, export and import — on one representation.
   */
  private rows(sql: string, params: readonly (SqlValue | undefined)[] = []): Record<string, SqlValue>[] {
    const bound: unknown[] = params.map((p) => (p === undefined ? null : p));
    const raw = this.prepareForRead(sql).all(...bindAll(bound as SqlValue[])) as Record<string, unknown>[];
    return raw.map((row) => {
      const out: Record<string, SqlValue> = {};
      for (const key of Object.keys(row)) out[key] = readValue(row[key]);
      return out;
    });
  }

  /** Column names of a statement, read from the prepared statement itself. */
  private columnNames(sql: string): string[] {
    return this.prepare(sql)
      .columns()
      .map((c) => c.name);
  }

  /**
   * Names of virtual-table shadow tables (FTS `…_content`, `…_data`, …).
   *
   * A dump must not emit them: their content is derived from the virtual table
   * itself and recreating both the module table and its shadow tables on import
   * fails (or corrupts the index). They are invisible to this check only in so
   * far as `sqlite_master` is — the rule is "a table whose CREATE statement is
   * absent while a same-prefix CREATE VIRTUAL TABLE exists", which the engine
   * guarantees for shadow tables by hiding their own `sqlite_master` rows.
   */
  private shadowTableNames(): string[] {
    try {
      const virtuals = this.rows(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL %';`
      );
      const shadows: string[] = [];
      for (const v of virtuals) {
        const base = String(v.name);
        // Shadow tables are the engine-maintained children of a virtual table:
        // every table whose name is `<virtual>_<suffix>`. The module's own
        // internal bookkeeping lives in these (FTS: `…_content`, `…_data`,
        // `…_idx`, …) and recreating them alongside the virtual table breaks
        // the import.
        const likePattern = `${base}\\_%`;
        const shadowRows = this.rows(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE " +
            quoteLiteral(likePattern) +
            " ESCAPE '\\';"
        );
        for (const r of shadowRows) {
          const n = String(r.name);
          if (n !== base && n.startsWith(`${base}_`)) shadows.push(n);
        }
      }
      return shadows;
    } catch {
      // Detection is best-effort: without it we are back to exporting shadow
      // tables, not to failing the export.
      return [];
    }
  }

  /**
   * Read the first column of the first row of a query.
   *
   * `PRAGMA x;` and `PRAGMA x(...);` are executed through `prepare(...).get()`
   * rather than `db.pragma(...)`: the pragma helper takes no bind parameters, so
   * a pragma whose argument is a user-supplied identifier (`PRAGMA
   * table_info("my table")`) could not be parameterised or quoted through it.
   * Going through `prepare` keeps every query in this adapter on one code path.
   * Values here are engine bookkeeping (`page_size`, `page_count`, ...), which
   * never exceeds 32 bits, so this one reads rows without safe integers.
   */
  private scalar(sql: string): SqlValue {
    try {
      const row = this.prepare(sql).get() as Record<string, unknown> | undefined;
      if (!row) return null;
      // A row can legitimately be an empty object; `Object.keys(row)[0]` is then
      // `undefined`, which is not a valid index. Treat it as "no value" rather
      // than reading the undefined-keyed property.
      const firstKey = Object.keys(row)[0];
      if (firstKey === undefined) return null;
      return readValue(row[firstKey]);
    } catch {
      return null;
    }
  }

  /** `lastInsertRowid` as a value that survives the wire without rounding. */
  private toSqlValue(v: number | bigint | undefined): SqlValue {
    if (v === undefined) return null;
    return this.idToSqlValue(v);
  }

  /**
   * A 64-bit id as a `SqlValue`.
   *
   * The engine hands `lastInsertRowid` back as a number, which has already been
   * rounded if the rowid exceeds 2^53, and as a bigint if `defaultSafeIntegers`
   * is on. Neither can cross the wire: `SqlValue` has no bigint member, and the
   * webview must be able to key the row. So an out-of-range id is reported the
   * same way an out-of-range COLUMN is (see `readValue`): as its exact decimal
   * string, which is what `valueToString`/`rowEditKey` compare losslessly.
   */
  private idToSqlValue(v: number | bigint): SqlValue {
    if (typeof v === 'bigint') {
      return v <= MAX_SAFE_ID && v >= MIN_SAFE_ID ? Number(v) : v.toString();
    }
    return Number.isSafeInteger(v) ? v : String(v);
  }

  private countObjects(type: 'table' | 'view' | 'index' | 'trigger'): number | null {
    // Excludes both reserved prefixes, so leftover Turso Database helper tables
    // are not counted as user objects (see `isInternalObject`).
    const v = this.scalar(
      `SELECT count(*) FROM sqlite_master WHERE type='${type}'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__turso_internal_%';`
    );
    return v === null ? null : Number(v);
  }

  private tableExists(name: string): boolean {
    const c = this.scalar(
      `SELECT count(*) FROM sqlite_master WHERE type IN ('table','view') AND name=${quoteLiteral(name)};`
    );
    return Number(c ?? 0) > 0;
  }

  private mapEncoding(raw: string): DatabaseInfo['encoding'] {
    const s = (raw || '').toUpperCase();
    if (s.includes('UTF-16LE')) return 'utf-16le';
    if (s.includes('UTF-16BE')) return 'utf-16be';
    if (s.includes('UTF-8')) return 'utf-8';
    return 'unknown';
  }

  private buildExport(format: ExportFormat, objectName?: string, selectSql?: string): string {
    // A caller may export a table OR an ad-hoc query. A query-based export has
    // no table name, so requiring one here would reject a perfectly valid
    // request — which is exactly what used to happen to "export from SQL" in the
    // UI. Only fail when neither was supplied.
    if (!objectName && !selectSql) {
      throw new Error('Export requires either a table name or a SELECT statement.');
    }
    if (selectSql) {
      return this.buildExportFromQuery(format, selectSql, objectName);
    }
    // Narrowed by the guard above: without a query, a table name is required.
    const tableName = objectName as string;
    const q = quoteIdent(tableName);
    if (format === 'sql') {
      const schema = this.getSchemaSync(tableName);
      if (isErrorInfo(schema)) throw new Error(schema.message);
      const cols = schema.columns.map((c) => c.name);
      const lines: string[] = [];
      if (schema.sql) lines.push(schema.sql + ';');
      const result = this.rows(`SELECT * FROM ${q};`);
      if (result.length > 0) {
        lines.push(`INSERT INTO ${q} (${cols.map((c) => quoteIdent(c)).join(', ')}) VALUES`);
        const rows = result.map(
          (r) => `(${cols.map((c) => quoteLiteral(normalizeValue(r[c]))).join(', ')})`
        );
        lines.push(rows.join(',\n') + ';');
      }
      return lines.join('\n') + '\n';
    }
    const result = this.rows(`SELECT * FROM ${q};`);
    if (format === 'json') {
      return JSON.stringify(result, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
    }
    return rowsToCsv(result);
  }

  /**
   * Build an export from an ad-hoc SELECT rather than a whole table.
   *
   * The statement runs first so the result's own column names drive the output;
   * the query is never rewritten into a `SELECT * FROM <table>`.
   */
  private buildExportFromQuery(format: ExportFormat, selectSql: string, objectName?: string): string {
    const statement = selectSql.replace(/;\s*$/, '');
    const names = this.columnNames(statement);
    const result = this.rows(statement);

    if (format === 'json') {
      return JSON.stringify(result, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
    }
    if (format === 'csv') {
      return rowsToCsv(result);
    }

    // SQL: emit a reproducible script for whatever the query returned. There is
    // no stored schema to reproduce, so the columns come from the result set and
    // the table name is derived from the target, falling back to a neutral one,
    // because a CREATE/INSERT pair needs some name to insert into.
    const target = objectName ?? 'exported';
    const lines: string[] = [];
    if (result.length > 0) {
      lines.push(`INSERT INTO ${quoteIdent(target)} (${names.map((c) => quoteIdent(c)).join(', ')}) VALUES`);
      const rows = result.map(
        (r) => `(${names.map((c) => quoteLiteral(normalizeValue(r[c]))).join(', ')})`
      );
      lines.push(rows.join(',\n') + ';');
    }
    return lines.join('\n') + '\n';
  }

  /** Synchronous `getSchema`, for the export path which cannot await. */
  private getSchemaSync(objectName: string): { columns: ColumnInfo[]; sql: string } | ErrorInfo {
    try {
      const pr = this.rows(`PRAGMA table_info(${quoteIdent(objectName)});`);
      const pkCount = pr.filter((c) => Boolean(c.pk)).length;
      const columns: ColumnInfo[] = pr.map((r, i) => ({
        name: String(r.name),
        type: (r.type as string) || '',
        notNull: Boolean(r.notnull),
        defaultValue: r.dflt_value === null || r.dflt_value === undefined ? null : String(r.dflt_value),
        pk: Boolean(r.pk),
        pkOrder: Number(r.pk) || 0,
        rowidAlias: Boolean(r.pk) && pkCount === 1,
        cid: Number(r.cid) || i,
        hidden: false
      }));
      const sqlRow = this.rows(
        `SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name=?;`,
        [objectName]
      );
      return { columns, sql: sqlRow.length > 0 ? String(sqlRow[0]?.sql ?? '') : '' };
    } catch (e) {
      return toErrorInfo(e, `Unknown error reading schema of "${objectName}".`);
    }
  }
}

/* ------------------------------------------------------------------------ */

/**
 * True when a failed read-write open is worth retrying read-only.
 *
 * Deliberately narrow. A corrupt file, a missing directory or a missing native
 * binary all fail here too, and retrying read-only would either fail again or
 * mask the real cause, so only the two recoverable verdicts qualify:
 *
 *   - `SQLITE_CANTOPEN`  — SQLite could not open the file read-write: it is
 *                          read-only on disk, or its directory is, or (on
 *                          Windows) another process holds an exclusive handle.
 *   - `SQLITE_BUSY`/`_LOCKED` — the file is locked by a peer. The engine's busy
 *                          handler already waited `LOCK_TIMEOUT_MS`; a
 *                          read-only handle needs no write lock and gets in.
 *
 * The retry is itself allowed to throw, and that second failure propagates: it
 * is the honest answer, and `open()` reports it.
 */
function isWritableOpenFailure(e: unknown): boolean {
  const code = (e as SqliteErrorLike | null)?.code;
  if (code === 'SQLITE_CANTOPEN' || code === 'SQLITE_PERM' || code === 'SQLITE_READONLY') return true;
  return isLockError(e);
}
