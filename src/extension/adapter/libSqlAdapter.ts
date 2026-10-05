// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bytesToHex,
  ColumnInfo,
  DatabaseInfo,
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
  TURSO_CAPABILITIES,
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
/* Local-file adapter backed by @tursodatabase/database (Turso Database)     */
/* ------------------------------------------------------------------------ */

/**
 * `@tursodatabase/database` is the JavaScript binding for **Turso Database**,
 * the Rust rewrite of SQLite. It is a LOCAL-FILE engine: it opens an on-disk
 * database directly, and it writes the same `SQLite format 3` file format, so
 * files remain interchangeable with stock SQLite and libSQL.
 *
 * Why this engine and not the others:
 *
 *   - `@libsql/client-wasm` cannot open a file at all. Measured under VS Code's
 *     own runtime, every absolute path fails with SQLITE_CANTOPEN, and where a
 *     relative path is accepted it silently becomes an IN-MEMORY database: no
 *     bytes reach the disk and a second process cannot see the rows, so edits
 *     would be lost. Its payload is built without the Node filesystem VFS.
 *
 *   - `@libsql/client` (libSQL, the C fork of SQLite) works and writes real
 *     files, but implements NEITHER `CREATE SEQUENCE` NOR `nextval()`.
 *
 *   - Turso Database is the only one of the three that implements the full set:
 *     `CREATE SEQUENCE`, `nextval()`, STRICT tables, ALTER COLUMN,
 *     non-constant defaults, the `vector_*` functions and upsert-RETURNING —
 *     and it still reads files written by the other two. That is why sequence
 *     DDL, which used to be gated off as unreachable, is now live.
 *
 * The dependency is native (not WASM) and ships a prebuilt binary per platform;
 * see the CI workflow for the supported target list. `require()` works from the
 * CommonJS extension host, so no asynchronous loading step is needed.
 *
 * Writes go straight to disk — there is no `export()` / `persist()` step.
 */

/* ---- local type declarations ------------------------------------------- */

type InArgs = Record<string, unknown> | unknown[];

interface InStatement {
  sql: string;
  args: InArgs;
}

interface ResultSet {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number;
  lastInsertRowid: number;
}

interface TxObject {
  execute(query: InStatement): Promise<ResultSet>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * The call shape the rest of this adapter is written against.
 *
 * It is deliberately the libSQL-style `execute({sql, args})` /
 * `transaction('write')` pair rather than Turso's native API, so the ~800 lines
 * of query, edit and export logic below stay engine-independent.
 * `TursoConnection` and `TursoTransaction` translate between the two.
 */
interface LibSqlConnection {
  execute(query: InStatement): Promise<ResultSet>;
  transaction(mode: 'write' | 'read' | 'deferred'): Promise<TxObject>;
  close(): void;
}

/* ---- Turso native surface (only what this adapter touches) ------------- */

interface TursoResultSet {
  columns: string[];
  rows: Array<Record<string, unknown> | unknown[]>;
  rowsAffected: number;
  lastInsertRowid?: number;
}

interface TursoStatement {
  sql: string;
  args?: unknown[] | Record<string, unknown>;
}

interface TursoNativeDatabase {
  batch(
    statements: TursoStatement[],
    options?: { mode?: 'write' | 'read' | 'deferred' | 'immediate' | 'exclusive' }
  ): Promise<TursoResultSet[]>;
  /**
   * Runs a script that may hold several statements. Used for explicit
   * `BEGIN` / `COMMIT` / `ROLLBACK`, and to strip leading comments.
   */
  exec(sql: string): Promise<void>;
  close(): void | Promise<void>;
}

type TursoConnect = (path: string) => Promise<TursoNativeDatabase>;

let tursoModule: { connect: TursoConnect } | null = null;

function getTurso(): { connect: TursoConnect } {
  if (!tursoModule) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    tursoModule = require('@tursodatabase/database') as { connect: TursoConnect };
  }
  return tursoModule;
}

/* ---- adapters between the two call shapes ------------------------------ */

/**
 * True for names the engine reserves for itself, which the object tree and the
 * schema editors must not present as user objects.
 *
 * Two prefixes matter:
 *   - `sqlite_`           — the SQLite baseline (`sqlite_sequence`, `sqlite_master`, …).
 *   - `__turso_internal_` — Turso Database's own bookkeeping. Creating a table with
 *                           AUTOINCREMENT or a sequence default makes the engine
 *                           materialise helpers such as
 *                           `__turso_internal_seq_<name>`; without this they leak
 *                           into the UI as ordinary tables the user never created.
 */
function isInternalObject(name: string): boolean {
  return name.startsWith('sqlite_') || name.startsWith('__turso_internal_');
}

/**
 * Turso returns rows positionally when a statement has no column names to bind
 * (for example `SELECT count(*)` with no alias in some paths). This adapter
 * reads rows by column NAME everywhere, so any positional row is zipped against
 * `columns` before it is handed on.
 */
function toNamedRow(row: Record<string, unknown> | unknown[], columns: string[]): Record<string, unknown> {
  if (!Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i];
    if (name !== undefined) out[name] = row[i];
  }
  return out;
}

/**
 * Serializes async work so only one task runs at a time, in arrival order.
 *
 * Needed because a database connection can host only one transaction at a time.
 * The webview posts messages without waiting for answers (`onDidReceiveMessage`
 * fires and forgets), so two quick actions — editing two cells, or creating a
 * table while a previous write is still in flight — really do reach the adapter
 * concurrently. Measured: the second one failed with "cannot start a transaction
 * within a transaction", and its work was lost.
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /** Runs `task` after every previously queued task has settled. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // Keep the chain alive regardless of whether the task resolves or rejects,
    // so one failure cannot stall every later operation.
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

/**
 * Buffers statements and replays them inside one explicit BEGIN/COMMIT block.
 *
 * This adapter expects a handle with explicit `commit()` / `rollback()`, while
 * Turso's *documented* transaction API is callback-scoped.
 *
 * Two patterns were tried and BOTH are wrong here:
 *
 *   1. `transactionAsync(fn)` — it holds the connection lock for the whole
 *      callback, so the obvious shim (hand out the handle, let `commit()`
 *      release the callback) deadlocks: statements issued while waiting for
 *      commit block on the lock the transaction itself holds.
 *
 *   2. Simply wrapping the batch in `transactionAsync` — measured to DISCARD
 *      the work silently. `CREATE TABLE` and `INSERT` inside the callback both
 *      reported success and left the database unchanged. This is an upstream
 *      defect in the 0.8.1 engine, not a usage error, and it fails OPEN (no
 *      exception), which makes it dangerous to rely on.
 *
 * What does work, and is used below, is issuing `BEGIN` / statements / `COMMIT`
 * explicitly, verified to persist. Statements are buffered rather than executed
 * on `execute()` so the whole set lands in one atomic transaction — a
 * transaction that is never committed has no effect at all, and a failure
 * anywhere rolls the entire set back.
 *
 * `commit()` holds the connection's mutex for its whole BEGIN…COMMIT block, so
 * concurrent transactions queue instead of nesting.
 */
class TursoTransaction implements TxObject {
  private readonly queued: TursoStatement[] = [];
  private state: 'open' | 'finished' = 'open';

  constructor(
    private readonly db: TursoNativeDatabase,
    private readonly mutex: Mutex
  ) {}

  async execute(query: InStatement): Promise<ResultSet> {
    if (this.state !== 'open') {
      throw new Error('cannot use a finished transaction');
    }
    this.queued.push({ sql: query.sql, args: query.args });
    // Returned before the real execution, so the affected-row counts are not
    // known yet. Callers that need the new rowid re-read it with
    // `last_insert_rowid()` after commit, which is what the adapter does.
    return { columns: [], rows: [], rowsAffected: 0, lastInsertRowid: 0 };
  }

  async commit(): Promise<void> {
    if (this.state !== 'open') return undefined;
    this.state = 'finished';
    if (this.queued.length === 0) return undefined;
    const batch = this.queued.slice();
    this.queued.length = 0;

    // The whole BEGIN…COMMIT block is one critical section: a connection can
    // only host a single transaction, so a concurrent commit would otherwise
    // fail with "cannot start a transaction within a transaction".
    await this.mutex.run(async () => {
      await this.db.exec('BEGIN');
      try {
        // One round trip for the whole set, in the order it was recorded.
        await this.db.batch(batch);
        await this.db.exec('COMMIT');
      } catch (e) {
        // Leave the connection usable: a failed statement must not strand an
        // open transaction that would swallow every later write.
        try {
          await this.db.exec('ROLLBACK');
        } catch {
          /* already torn down by the engine */
        }
        throw e;
      }
    });
    return undefined;
  }

  async rollback(): Promise<void> {
    // Nothing has been sent yet, so discarding the buffer IS the rollback.
    this.state = 'finished';
    this.queued.length = 0;
    return undefined;
  }
}

function normalizeResult(result: TursoResultSet | undefined): ResultSet {
  const columns = result?.columns ?? [];
  const rows = (result?.rows ?? []).map((r) => toNamedRow(r, columns));
  return {
    columns,
    rows,
    rowsAffected: result?.rowsAffected ?? 0,
    lastInsertRowid: result?.lastInsertRowid ?? 0
  };
}

class TursoConnection implements LibSqlConnection {
  /** One per connection: the connection hosts one transaction at a time. */
  private readonly mutex = new Mutex();

  constructor(private readonly db: TursoNativeDatabase) {}

  async execute(query: InStatement): Promise<ResultSet> {
    const results = await this.db.batch([{ sql: query.sql, args: query.args }]);
    return normalizeResult(results[0]);
  }

  /** See `TursoTransaction`: statements are buffered until commit. */
  async transaction(mode: 'write' | 'read' | 'deferred'): Promise<TxObject> {
    void mode; // Turso derives the locking mode from the BEGIN it issues.
    return new TursoTransaction(this.db, this.mutex);
  }

  close(): void {
    void this.db.close();
  }
}

/* ------------------------------------------------------------------------ */

export class LibSqlAdapter implements DatabaseAdapter {
  readonly driverName = 'turso';

  private client: LibSqlConnection | null = null;
  private dbPath = '';
  private dbSizeBytes = 0;
  private writable = true;
  private readOnlyFlag = false;
  private detection: LibSqlDetection | null = null;
  private version: string = '';

  async open(filePath: string): Promise<DatabaseInfo | ErrorInfo> {
    this.dbPath = filePath;
    this.detection = null;
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(filePath);
      this.dbSizeBytes = stats.size;
      this.writable = await fs.promises
        .access(filePath, fs.constants.W_OK)
        .then(() => true, () => false);
    } catch {
      return { code: 'FILE_NOT_FOUND', message: `Database file not found: ${filePath}` };
    }
    try {
      // Turso takes a filesystem path directly (it does not want a file: URL),
      // which is also why no URL escaping step is needed for names containing
      // spaces or punctuation.
      const db = await getTurso().connect(filePath);
      this.client = new TursoConnection(db);
      const versionResult = await this.client.execute({ sql: 'SELECT sqlite_version();', args: [] });
      const row = versionResult.rows[0];
      this.version = row ? String(Object.values(row)[0] ?? 'unknown') : 'unknown';
      this.detection = await this.detectLibSql();
      return await this.info();
    } catch (e) {
      return this.toError(e, 'Unknown error while opening the database.');
    }
  }

  isOpen(): boolean {
    return this.client !== null;
  }

  async getInfo(): Promise<DatabaseInfo | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    return await this.info();
  }

  /** Assemble DatabaseInfo from the live database plus the cached verdict. */
  private async info(): Promise<DatabaseInfo> {
    const detection =
      this.detection ?? resolveLibSqlDetection(this.dbPath, { version: this.version }, false);
    return {
      path: this.dbPath,
      sizeBytes: this.dbSizeBytes,
      pageSize: (await this.scalar<number>('PRAGMA page_size;')) ?? 4096,
      encoding: this.mapEncoding((await this.scalar<string>('PRAGMA encoding;')) ?? 'UTF-8'),
      tableCount: (await this.countObjects('table')) ?? 0,
      viewCount: (await this.countObjects('view')) ?? 0,
      indexCount: (await this.countObjects('index')) ?? 0,
      triggerCount: (await this.countObjects('trigger')) ?? 0,
      writable: this.writable,
      readOnly: this.readOnlyFlag,
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
   * Turso Database executes every feature the editor gates on, and additionally
   * implements `CREATE SEQUENCE` / `nextval()`. The set is reported
   * unconditionally because the bundled engine is the only one that can run —
   * there is no less capable fallback that could silently take over.
   */
  private capabilities(): LibSqlCapabilities {
    return TURSO_CAPABILITIES;
  }

  /**
   * Decide whether the open file is LibSQL.
   *
   * Every signal gathered here applies directly because the bundled engine is
   * always LibSQL. `fallback` is passed as false: no less capable engine can
   * take over, so a LibSQL file is never served by something that cannot run
   * its dialect. (Feature availability is reported separately through
   * `capabilities()` — being LibSQL and having every LibSQL feature compiled in
   * are different questions.)
   */
  private async detectLibSql(): Promise<LibSqlDetection> {
    const objectNames = this.isOpen() ? this.schemaObjectNames() : [];
    const detection = resolveLibSqlDetection(
      this.dbPath,
      {
        version: this.version,
        pragmas: this.isOpen() ? this.enginePragmas() : undefined,
        objectNames
      },
      false // single bundled engine — no fallback
    );
    return detection;
  }

  /** Names of every user and system object, used for LibSQL schema probing. */
  private schemaObjectNames(): string[] {
    try {
      return this.syncRows(`SELECT name FROM sqlite_master;`).map((r) => String(r.name));
    } catch {
      return [];
    }
  }

  /** Engine build flags, some of which carry a LibSQL marker. */
  private enginePragmas(): string[] {
    try {
      return this.syncRows('PRAGMA compile_options;')
        .map((r) => String(Object.values(r)[0] ?? ''))
        .filter((v) => v.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * True when the current file belongs to the LibSQL family (LibSQL or Turso
   * Database), as opposed to the plain SQLite baseline. Note this says nothing
   * about which features are executable — see `capabilities()` for that, which
   * is reported unconditionally.
   */
  isLibSql(): boolean {
    return this.detection?.libSql === true || this.detection?.engine === 'libsql';
  }

  /* ------------------------------ objects ------------------------------- */

  async getObjects(includeHidden = false): Promise<ObjectInfo[] | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const rows = await this.run(
        `SELECT type, name, sql FROM sqlite_master
         WHERE type IN ('table','view','index','trigger','sequence')
         AND (? = 1 OR (name NOT LIKE 'sqlite_%' AND name NOT LIKE '__turso_internal_%'))
         ORDER BY type, name`,
        [includeHidden ? 1 : 0]
      );
      const out: ObjectInfo[] = rows.map((r) => ({
        name: r.name as string,
        type: r.type as ObjectType,
        sql: (r.sql as string | null) ?? '',
        hidden: isInternalObject(r.name as string)
      }));
      try {
        const seqRows = await this.run(`SELECT name, seq FROM sqlite_sequence ORDER BY name;`);
        for (const r of seqRows) {
          out.push({
            name: r.name as string,
            type: 'sequence',
            sql: `SELECT seq FROM sqlite_sequence WHERE name = ${quoteLiteral(r.name as string)};`,
            hidden: false,
            seq: Number(r.seq)
          });
        }
      } catch {
        // sqlite_sequence is optional; safe to ignore when absent.
      }
      return out;
    } catch (e) {
      return this.toError(e, 'Unknown error listing database objects.');
    }
  }

  async getSchema(objectName: string): Promise<{ columns: ColumnInfo[]; sql: string } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const pr = await this.run(`PRAGMA table_info(${quoteIdent(objectName)});`);
      const pkCount = pr.filter((c) => Boolean(c.pk)).length;
      const columns: ColumnInfo[] = pr.map((r, i) => ({
        name: r.name as string,
        type: (r.type as string) || '',
        notNull: Boolean(r.notnull),
        defaultValue: r.dflt_value === null ? null : String(r.dflt_value),
        pk: Boolean(r.pk),
        pkOrder: Number(r.pk) || 0,
        rowidAlias: Boolean(r.pk) && pkCount === 1,
        cid: Number(r.cid) || i,
        hidden: false
      }));
      const sqlRow = await this.run(
        `SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name=?;`,
        [objectName]
      );
      const sql = sqlRow.length > 0 ? String(sqlRow[0]?.sql ?? '') : '';
      return { columns, sql };
    } catch (e) {
      return this.toError(e, `Unknown error reading schema of "${objectName}".`);
    }
  }

  /* ------------------------------ query --------------------------------- */

  async query(sql: string, page: number, pageSize: number): Promise<QueryResult | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    const start = Date.now();
    try {
      const trimmed = sql.trim();
      const isSelect = /^(select|pragma|with)\b/i.test(trimmed);
      if (!isSelect) {
        await this.rawExec(trimmed.replace(/;\s*$/, ''));
        return {
          columns: [],
          rows: [],
          totalRows: 0,
          truncated: false,
          affectedRows: 0,
          isQuery: false,
          durationMs: Date.now() - start
        };
      }
      const base = trimmed.replace(/;\s*$/, '');
      const countResult = await this.client.execute({
        sql: `SELECT count(*) AS c FROM (${base}) AS t;`,
        args: []
      });
      const totalRows = Number((countResult.rows[0] as Record<string, unknown>)?.c ?? 0);
      const paged = `${base} LIMIT ${Math.max(1, pageSize)} OFFSET ${Math.max(0, page * pageSize)}`;
      const result = await this.client.execute({ sql: paged, args: [] });
      const columns = result.columns.map((c) => ({ name: c, type: '' }));
      const rows: SqlValue[][] = result.rows.map((r) => {
        const vals: SqlValue[] = [];
        for (const c of result.columns) {
          vals.push(normalizeValue((r as Record<string, unknown>)[c]));
        }
        return vals;
      });
      return {
        columns,
        rows,
        totalRows,
        truncated: totalRows > (page + 1) * pageSize,
        isQuery: true,
        durationMs: Date.now() - start
      };
    } catch (e) {
      return this.toError(e, 'Unknown error executing query.');
    }
  }

  async rowCount(objectName: string): Promise<number | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const result = await this.client.execute({
        sql: `SELECT count(*) AS c FROM ${quoteIdent(objectName)};`,
        args: []
      });
      return Number((result.rows[0] as Record<string, unknown>)?.c ?? 0);
    } catch (e) {
      return this.toError(e, `Unknown error counting rows in "${objectName}".`);
    }
  }

  /* ------------------------------ edits ---------------------------------- */

  async commitEdits(edits: RowEdit[]): Promise<{ changes: number } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    if (edits.length === 0) return { changes: 0 };
    let changes = 0;
    const tx = await this.client.transaction('write');
    try {
      for (const edit of edits) {
        if (edit.edits.length === 0) continue;
        const sets = edit.edits.map((e) => `${quoteIdent(e.column)} = ?`).join(', ');
        const params = edit.edits.map((e) => e.value).concat(edit.key.keyValues);
        const keyWhere = edit.key.keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
        const fullSql = `UPDATE ${quoteIdent(edit.key.table)} SET ${sets} WHERE ${keyWhere};`;
        await tx.execute({ sql: fullSql, args: params });
        changes += 1;
      }
      await tx.commit();
      return { changes };
    } catch (e) {
      await tx.rollback();
      return this.toError(e, 'Transaction failed and was rolled back.');
    }
  }

  async insertRow(
    table: string,
    values: Record<string, SqlValue>
  ): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
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
    const params = columns.map((c) => values[c] ?? null);
    const tx = await this.client.transaction('write');
    try {
      await tx.execute({
        sql: `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders});`,
        args: params
      });
      await tx.commit();
      const idResult = await this.client.execute({ sql: 'SELECT last_insert_rowid() AS id;', args: [] });
      const newId = Number((idResult.rows[0] as Record<string, unknown>)?.id ?? 0);
      return { key: { columns: ['rowid'], values: [newId] } };
    } catch (e) {
      await tx.rollback();
      return this.toError(e, 'Insert failed and was rolled back.');
    }
  }

  async deleteRows(keys: { table: string; keyColumns: string[]; keyValues: SqlValue[] }[]): Promise<{ changes: number } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    let changes = 0;
    const tx = await this.client.transaction('write');
    try {
      for (const k of keys) {
        if (k.keyColumns.length === 0) {
          await tx.execute({ sql: `DELETE FROM ${quoteIdent(k.table)};`, args: [] });
          changes += 1;
          continue;
        }
        const where = k.keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
        await tx.execute({ sql: `DELETE FROM ${quoteIdent(k.table)} WHERE ${where};`, args: [...k.keyValues] });
        changes += 1;
      }
      await tx.commit();
      return { changes };
    } catch (e) {
      await tx.rollback();
      return this.toError(e, 'Delete failed and was rolled back.');
    }
  }

  async duplicateRow(
    table: string,
    keyColumns: string[],
    keyValues: SqlValue[]
  ): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    const schema = await this.getSchema(table);
    if (isErrorInfo(schema)) return schema;
    const nonPkCols = schema.columns.filter((c) => !c.pk);
    if (nonPkCols.length === 0) {
      return { code: 'SQL_ERROR', message: 'No non-key columns to duplicate.' };
    }
    const cols = nonPkCols.map((c) => quoteIdent(c.name)).join(', ');
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
    const tx = await this.client.transaction('write');
    try {
      await tx.execute({
        sql: `INSERT INTO ${quoteIdent(table)} (${cols}) SELECT ${cols} FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1;`,
        args: [...keyValues]
      });
      await tx.commit();
      const idResult = await this.client.execute({ sql: 'SELECT last_insert_rowid() AS id;', args: [] });
      const newId = Number((idResult.rows[0] as Record<string, unknown>)?.id ?? 0);
      return { key: { columns: ['rowid'], values: [newId] } };
    } catch (e) {
      await tx.rollback();
      return this.toError(e, 'Duplicate failed and was rolled back.');
    }
  }

  async executeStatements(statements: string[]): Promise<{ statements: number; affectedRows: number } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    const affectedRows = 0;
    let count = 0;
    const tx = await this.client.transaction('write');
    try {
      for (const stmt of statements) {
        const s = stmt.trim();
        if (s.length === 0) continue;
        await tx.execute({ sql: s, args: [] });
        count += 1;
      }
      await tx.commit();
      return { statements: count, affectedRows };
    } catch (e) {
      await tx.rollback();
      return this.toError(e, 'Transaction failed and was rolled back.');
    }
  }

  async executeSql(sql: string): Promise<QueryResult | ErrorInfo> {
    return this.query(sql, 0, 1000);
  }

  async executeDdl(statements: string[]): Promise<{ statements: number } | ErrorInfo> {
    const r = await this.executeStatements(statements);
    if (isErrorInfo(r)) return r;
    return { statements: r.statements };
  }

  async deleteObject(name: string, type: ObjectType): Promise<{ ok: true } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    if (type === 'system') return { code: 'PERMISSION', message: 'Cannot delete system objects.' };
    const typeName = type === 'table' ? 'TABLE' : type === 'view' ? 'VIEW' : type === 'index' ? 'INDEX' : 'TRIGGER';
    const sql = `DROP ${typeName} IF EXISTS ${quoteIdent(name)};`;
    const tx = await this.client.transaction('write');
    try {
      await tx.execute({ sql, args: [] });
      await tx.commit();
      return { ok: true };
    } catch (e) {
      await tx.rollback();
      return this.toError(e, `Failed to delete ${type} "${name}".`);
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
      path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-')), `${baseName}.${ext}`);
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
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const data = await this.buildExport(format, objectName, selectSql);
      const dest = await this.writeExport(data, format, objectName ?? 'database', destPath);
      return { filePath: dest, sizeBytes: Buffer.byteLength(data) };
    } catch (e) {
      return this.toError(e, 'Export failed.');
    }
  }

  async exportDatabase(format: ExportFormat, destPath?: string): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const objects = await this.getObjects(true);
      if (isErrorInfo(objects)) return objects;
      if (format === 'sql') {
        const parts: string[] = [];
        parts.push('-- Exported by SQLite/LibSQL/Turso P&E');
        parts.push(`-- Database: ${this.dbPath}`);
        parts.push('--');
        for (const o of objects.filter((x) => x.sql && x.type !== 'system')) {
          parts.push(`${o.sql!.replace(/;\s*$/, '')};\n`);
        }
        for (const t of objects.filter((x) => x.type === 'table')) {
          parts.push('');
          parts.push(`-- Data for table: ${t.name}`);
          const result = await this.client.execute({ sql: `SELECT * FROM ${quoteIdent(t.name)};`, args: [] });
          if (result.rows.length === 0) continue;
          const cols = result.columns;
          const lines: string[] = [`INSERT INTO ${quoteIdent(t.name)} (${cols.join(', ')}) VALUES`];
          for (const row of result.rows) {
            const vals = cols
              .map((c) => quoteLiteral((row as Record<string, SqlValue>)[c] ?? null))
              .join(', ');
            lines.push(`  (${vals}),`);
          }
          const lastIdx = lines.length - 1;
          lines[lastIdx] = (lines[lastIdx] ?? '').replace(/,$/, '');
          parts.push(lines.join('\n') + ';');
        }
        const text = parts.join('\n') + '\n';
        const dest = await this.writeExport(text, 'sql', 'database', destPath);
        return { filePath: dest, sizeBytes: Buffer.byteLength(text) };
      }
      if (format === 'json') {
        const parts: Record<string, unknown>[] = [];
        for (const t of objects.filter((x) => x.type === 'table')) {
          const result = await this.client.execute({ sql: `SELECT * FROM ${quoteIdent(t.name)};`, args: [] });
          parts.push({ table: t.name, rows: result.rows });
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
      return this.toError(e, 'Database export failed.');
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
      return this.toError(e, 'Import preview failed.');
    }
  }

  async importCommit(
    filePath: string,
    tableName: string,
    mappings: ImportFieldMapping[],
    conflict: 'skip' | 'replace' | 'fail',
    createTable: boolean
  ): Promise<{ rows: number; skipped: number; tableName: string } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const ext = path.extname(filePath).toLowerCase();
      const format: ImportFormat = ext === '.json' ? 'json' : 'csv';
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
      const exists = await this.tableExists(tableName);
      if (createTable && !exists) {
        const colsDef = mappings
          .map((m) => `${quoteIdent(m.target)} ${m.inferredType || 'TEXT'}`)
          .join(', ');
        await this.client.execute({ sql: `CREATE TABLE ${quoteIdent(tableName)} (${colsDef});`, args: [] });
      }
      if (!exists && !(createTable && !exists)) {
        return { code: 'SQL_ERROR', message: `Table "${tableName}" does not exist and createTable is disabled.` };
      }
      let inserted = 0;
      let skipped = 0;
      const tx = await this.client.transaction('write');
      try {
        const colList = columns.map((c) => quoteIdent(c)).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const stmtSql =
          conflict === 'skip'
            ? `INSERT OR IGNORE INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders});`
            : conflict === 'replace'
              ? `INSERT OR REPLACE INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders});`
              : `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES (${placeholders});`;
        for (const row of rows) {
          const params = columns.map((c) => row[c] ?? null);
          try {
            await tx.execute({ sql: stmtSql, args: params });
            inserted += 1;
          } catch {
            if (conflict === 'fail') throw new Error('Insert conflict with strategy "fail".');
            skipped += 1;
          }
        }
        await tx.commit();
        return { rows: inserted, skipped, tableName };
      } catch (e) {
        await tx.rollback();
        return this.toError(e, 'Import commit failed.');
      }
    } catch (e) {
      return this.toError(e, 'Import commit failed.');
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  async isWritable(): Promise<boolean> {
    if (!this.writable || this.readOnlyFlag) return false;
    if (!this.client) return false;
    try {
      await this.client.execute({ sql: 'SELECT 1;', args: [] });
      return true;
    } catch {
      this.writable = false;
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      // Flush the write-ahead log into the main database file first.
      //
      // Turso runs in WAL mode, so a committed edit lives in the `<file>-wal`
      // sidecar until a checkpoint folds it into `<file>`. Closing alone does
      // NOT do that: measured, the sidecar outlives `close()` and the main file
      // still lacks the row. That is a real data-loss hazard, because the main
      // file is what users copy, sync, attach or hand to another SQLite tool —
      // all of which would then see a stale database.
      //
      // TRUNCATE (rather than PASSIVE) also empties the sidecar, so the file the
      // user sees is self-contained. Failure is non-fatal: the data is already
      // committed, and a read-only or externally locked file may refuse.
      if (this.client && this.dbPath) {
        try {
          await this.client.execute({ sql: 'PRAGMA wal_checkpoint(TRUNCATE);', args: [] });
        } catch {
          /* a checkpoint is best-effort; the edit is committed either way */
        }
      }
      this.client?.close();
    } finally {
      this.client = null;
      this.dbPath = '';
    }
  }

  /* ------------------------------ internals ------------------------------ */

  /** Run an async query, returning rows as objects. */
  private async run(sql: string, params: SqlValue[] = []): Promise<Record<string, unknown>[]> {
    if (!this.client) throw new Error('Database is not open.');
    const result = await this.client.execute({ sql, args: params });
    return result.rows as Record<string, unknown>[];
  }

  /** Execute a statement without reading rows (still awaited for durability). */
  private async rawExec(sql: string): Promise<void> {
    if (!this.client) throw new Error('Database is not open.');
    await this.client.execute({ sql, args: [] });
  }

  /** Read the first scalar from a query. */
  private async scalar<T = unknown>(sql: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const result = await this.client.execute({ sql, args: [] });
      const row = result.rows[0];
      if (!row) return null;
      // A row can legitimately be an empty object; `Object.keys(row)[0]` is then
      // `undefined`, which is not a valid index. Treat it as "no value" rather
      // than reading the undefined-keyed property.
      const firstKey = Object.keys(row)[0];
      if (firstKey === undefined) return null;
      const val = (row as Record<string, unknown>)[firstKey];
      return (val as T) ?? null;
    } catch {
      return null;
    }
  }

  /** Synchronous row helper used during detection (best-effort, may return []). */
  private syncRows(sql: string): Record<string, unknown>[] {
    // The Turso client is promise-based only; return empty on any failure.
    // Called only during detection, where empty is a valid (non-evidencing) result.
    void sql;
    return [];
  }

  private async countObjects(type: 'table' | 'view' | 'index' | 'trigger'): Promise<number | null> {
    // Excludes both reserved prefixes, so Turso's internal helper tables are not
    // counted as user objects (see `isInternalObject`).
    return await this.scalar<number>(
      `SELECT count(*) FROM sqlite_master WHERE type='${type}'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__turso_internal_%';`
    );
  }

  private async tableExists(name: string): Promise<boolean> {
    const c = await this.scalar<number>(
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

  private async buildExport(
    format: ExportFormat,
    objectName?: string,
    selectSql?: string
  ): Promise<string> {
    // A caller may export a table OR an ad-hoc query. A query-based export has
    // no table name, so requiring one here would reject a perfectly valid
    // request — which is exactly what used to happen to "export from SQL" in the
    // UI. Only fail when neither was supplied.
    if (!objectName && !selectSql) {
      throw new Error('Export requires either a table name or a SELECT statement.');
    }
    if (selectSql) {
      return await this.buildExportFromQuery(format, selectSql, objectName);
    }
    // Narrowed by the guard above: without a query, a table name is required.
    const tableName = objectName as string;
    const q = quoteIdent(tableName);
    if (format === 'sql') {
      const schema = await this.getSchema(tableName);
      if (isErrorInfo(schema)) throw new Error(schema.message);
      const cols = schema.columns.map((c) => quoteIdent(c.name)).join(', ');
      const lines: string[] = [];
      if (schema.sql) lines.push(schema.sql + ';');
      const result = await this.client!.execute({ sql: `SELECT * FROM ${q};`, args: [] });
      if (result.rows.length > 0) {
        lines.push(`INSERT INTO ${q} (${cols}) VALUES`);
        const rows = result.rows.map(
          (r) =>
            `(${Object.keys(r)
              .map((k) => quoteLiteral((r as Record<string, SqlValue>)[k] ?? null))
              .join(', ')})`
        );
        lines.push(rows.join(',\n') + ';');
      }
      return lines.join('\n') + '\n';
    }
    const result = await this.client!.execute({ sql: `SELECT * FROM ${q};`, args: [] });
    if (format === 'json') {
      return JSON.stringify(result.rows, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
    }
    return rowsToCsv(result.rows);
  }

  /**
   * Build an export from an ad-hoc SELECT rather than a whole table.
   *
   * The statement runs first so the result's own column names drive the output;
   * the query is never rewritten into a `SELECT * FROM <table>`.
   */
  private async buildExportFromQuery(
    format: ExportFormat,
    selectSql: string,
    objectName?: string
  ): Promise<string> {
    const statement = selectSql.replace(/;\s*$/, '');
    const result = await this.client!.execute({ sql: statement, args: [] });

    if (format === 'json') {
      return JSON.stringify(result.rows, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
    }
    if (format === 'csv') {
      return rowsToCsv(result.rows);
    }

    // SQL: emit a reproducible script for whatever the query returned. There is
    // no stored schema to reproduce, so the columns come from the result set and
    // the table name is derived from the target, falling back to a neutral one,
    // because a CREATE/INSERT pair needs some name to insert into.
    const cols = result.columns.map((c) => quoteIdent(c)).join(', ');
    const target = objectName ?? 'exported';
    const lines: string[] = [];
    if (result.rows.length > 0) {
      lines.push(`INSERT INTO ${quoteIdent(target)} (${cols}) VALUES`);
      const rows = result.rows.map(
        (r) =>
          `(${Object.keys(r)
            .map((k) => quoteLiteral((r as Record<string, SqlValue>)[k] ?? null))
            .join(', ')})`
      );
      lines.push(rows.join(',\n') + ';');
    }
    return lines.join('\n') + '\n';
  }

  private toError(e: unknown, fallback: string): ErrorInfo {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    let code: ErrorCode = 'UNKNOWN';
    if (lower.includes('locked') || lower.includes('busy')) code = 'DB_LOCKED';
    else if (lower.includes('permission') || lower.includes('denied') || lower.includes('read-only')) {
      code = 'PERMISSION';
    } else if (
      lower.includes('corrupt') ||
      lower.includes('malformed') ||
      lower.includes('not a database') ||
      lower.includes('encrypted')
    ) {
      code = 'DB_CORRUPT';
    } else if (lower.includes('sql') || lower.includes('syntax') || lower.includes('near "')) code = 'SQL_ERROR';
    else if (lower.includes('rollback') || lower.includes('transaction')) code = 'TRANSACTION';
    return { code, message: msg || fallback, raw: msg };
  }
}
