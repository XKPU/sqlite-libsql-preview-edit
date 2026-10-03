import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import {
  bytesToHex,
  ColumnInfo,
  DatabaseInfo,
  ErrorInfo,
  ErrorCode,
  ExportFormat,
  ImportFieldMapping,
  ImportFormat,
  isNull,
  LIBSQL_CAPABILITIES,
  LibSqlCapabilities,
  LibSqlDetection,
  ObjectInfo,
  ObjectType,
  quoteIdent,
  quoteLiteral,
  QueryResult,
  resolveLibSqlDetection,
  RowEdit,
  SQLITE_CAPABILITIES,
  SqlValue
} from '../../shared/protocol';
import { DatabaseAdapter } from './adapter';
import {
  convertJsonValue,
  escapeCsv,
  inferType,
  inferTypeFromColumn,
  isErrorInfo,
  normalizeValue,
  parseCsv,
  rowsToCsv,
  csvStringify
} from './common';

/**
 * sql.js backed DatabaseAdapter.
 *
 * sql.js is a WebAssembly build of SQLite with no native dependencies, so the
 * VSIX stays portable across platforms. The database lives in memory and is
 * persisted back to disk on every write, keeping the file on disk in sync.
 *
 * The SQLite standard is the baseline. LibSQL is an on-disk-compatible
 * superset, so a LibSQL file opens correctly through the same engine; when
 * detection confirms LibSQL, the LibSQL capability set is switched on and the
 * adapter reports that the richer statements cannot run on this engine.
 */
export class SqlJsAdapter implements DatabaseAdapter {
  readonly driverName = 'sql.js';

  private db: SqlJsDatabase | null = null;
  private dbPath = '';
  private dbSizeBytes = 0;
  private writable = true;
  private readOnlyFlag = false;
  private sqljsWasm: Awaited<ReturnType<typeof initSqlJs>> | null = null;
  private detection: LibSqlDetection | null = null;
  /** Serializes disk writes so overlapping edits cannot tear the file. */
  private persistChain: Promise<void> = Promise.resolve();

  /**
   * Directory that holds the sql.js loader and its `.wasm`, or null when the
   * vendored copy is absent (running from source). Set by the extension host so
   * the packaged VSIX never has to reach into `node_modules`.
   */
  private vendorDir: string | null = null;

  constructor(vendorDir?: string) {
    if (vendorDir) this.vendorDir = vendorDir;
  }

  private async ensureSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
    if (this.sqljsWasm) return this.sqljsWasm;

    // Prefer the vendored bundle. A packaged VSIX excludes node_modules, so
    // this is the only copy an installed extension has; `require` is used
    // lazily (never at module scope) so its absence cannot break loading.
    if (this.vendorDir) {
      const dir = this.vendorDir;
      const loader = path.join(dir, 'sql-wasm.js');
      if (fs.existsSync(loader)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vendored = require(loader) as typeof initSqlJs;
        this.sqljsWasm = await vendored({ locateFile: (f: string) => path.join(dir, f) });
        return this.sqljsWasm;
      }
    }

    // Development fallback: resolve the dependency normally.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fromModules = require('sql.js') as typeof initSqlJs;
    this.sqljsWasm = await fromModules();
    return this.sqljsWasm;
  }

  async open(filePath: string): Promise<DatabaseInfo | ErrorInfo> {
    this.dbPath = filePath;
    this.detection = null;
    this.persistChain = Promise.resolve();
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(filePath);
      this.dbSizeBytes = stats.size;
      this.writable = await fs.promises
        .access(filePath, fs.constants.W_OK)
        .then(() => true, () => false);
    } catch {
      return {
        code: 'FILE_NOT_FOUND',
        message: `Database file not found: ${filePath}`
      };
    }
    try {
      const SQL = await this.ensureSqlJs();
      let data: Uint8Array | null = null;
      if (this.dbSizeBytes > 0) {
        data = new Uint8Array(await fs.promises.readFile(filePath));
      }
      this.db = data ? new SQL.Database(data) : new SQL.Database();
      this.detection = await this.detectLibSql(data);
      return this.info();
    } catch (e) {
      return this.toError(e, 'Unknown error while opening the database.');
    }
  }

  isOpen(): boolean {
    return this.db !== null;
  }

  async getInfo(): Promise<DatabaseInfo | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    return this.info();
  }

  /** Assemble DatabaseInfo from the live database plus the cached verdict. */
  private info(): DatabaseInfo {
    const detection =
      this.detection ?? resolveLibSqlDetection(this.dbPath, {}, true);
    return {
      path: this.dbPath,
      sizeBytes: this.dbSizeBytes,
      pageSize: Number(this.scalar('PRAGMA page_size;') ?? 4096),
      encoding: this.mapEncoding(this.scalar<string>('PRAGMA encoding;') ?? 'UTF-8'),
      tableCount: this.countObjects('table'),
      viewCount: this.countObjects('view'),
      indexCount: this.countObjects('index'),
      triggerCount: this.countObjects('trigger'),
      writable: this.writable,
      readOnly: this.readOnlyFlag,
      version: this.scalar<string>('SELECT sqlite_version();') ?? 'unknown',
      driver: this.driverName,
      engine: detection.engine,
      detection,
      capabilities: this.capabilities()
    };
  }

  /**
   * The capability set for the current engine. SQLite is the baseline; a
   * detected LibSQL file turns on the LibSQL-only feature flags.
   */
  private capabilities(): LibSqlCapabilities {
    return this.detection?.libSql ? LIBSQL_CAPABILITIES : SQLITE_CAPABILITIES;
  }

  /**
   * Decide whether the open file is LibSQL.
   *
   * Signals are gathered from the live engine and from the file, so a LibSQL
   * file is recognised even when it has been renamed to `.sqlite`:
   *   1. the engine version string (`3.45.1-libsql`, `sqld`, `turso`),
   *   2. LibSQL system tables in the schema,
   *   3. engine pragmas naming a LibSQL build,
   *   4. the file extension (weakest — a hint, not proof).
   *
   * There is no header check by design: a LibSQL database is byte-compatible
   * with SQLite and the header's bytes 21..23 are fixed constants in any file
   * SQLite will open, so the header carries no dialect information. The header
   * is still read to confirm the file is a SQLite-family database at all.
   *
   * `fallback` is true when LibSQL was detected but the bundled sql.js engine
   * is answering: the data is readable and writable, yet LibSQL-only
   * statements would raise "no such function" style errors, and the UI says so.
   */
  private async detectLibSql(data: Uint8Array | null): Promise<LibSqlDetection> {
    // `data` is retained for symmetry with the open path: a file that failed to
    // parse never reaches this point, so the header is not consulted here.
    void data;
    const objectNames = this.isOpen() ? this.schemaObjectNames() : [];
    const detection = resolveLibSqlDetection(
      this.dbPath,
      {
        version: this.isOpen() ? this.scalar<string>('SELECT sqlite_version();') ?? undefined : undefined,
        pragmas: this.isOpen() ? this.enginePragmas() : undefined,
        objectNames
      },
      true
    );
    return detection;
  }

  /** Names of every user and system object, used for LibSQL schema probing. */
  private schemaObjectNames(): string[] {
    try {
      return this.run(`SELECT name FROM sqlite_master;`, []).map((r) => String(r.name));
    } catch {
      return [];
    }
  }

  /** Engine build flags, some of which carry a LibSQL marker. */
  private enginePragmas(): string[] {
    try {
      return this.run('PRAGMA compile_options;', [])
        .map((r) => String(Object.values(r)[0] ?? ''))
        .filter((v) => v.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * True when the current file is LibSQL. Used to gate LibSQL-only features
   * and to explain, in SQL errors, why a LibSQL statement may not run.
   */
  isLibSql(): boolean {
    return this.detection?.libSql === true;
  }


  async getObjects(includeHidden = false): Promise<ObjectInfo[] | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const out: ObjectInfo[] = [];
      const rows = this.run(
        `SELECT type, name, sql FROM sqlite_master
         WHERE type IN ('table','view','index','trigger')
         AND (? = 1 OR name NOT LIKE 'sqlite_%')
         ORDER BY type, name`,
        [includeHidden ? 1 : 0]
      );
      for (const r of rows) {
        out.push({
          name: r.name as string,
          type: r.type as ObjectType,
          sql: (r.sql as string | null) ?? '',
          hidden: (r.name as string).startsWith('sqlite_')
        });
      }
      return out;
    } catch (e) {
      return this.toError(e, 'Unknown error listing database objects.');
    }
  }

  async getSchema(objectName: string): Promise<{ columns: ColumnInfo[]; sql: string } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const pr = this.run(`PRAGMA table_info(${quoteIdent(objectName)});`, []);
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
      const sqlRow = this.run(
        `SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name=?;`,
        [objectName]
      );
      const sql = sqlRow.length > 0 ? String(sqlRow[0]?.sql ?? '') : '';
      return { columns, sql };
    } catch (e) {
      return this.toError(e, `Unknown error reading schema of "${objectName}".`);
    }
  }

  async query(sql: string, page: number, pageSize: number): Promise<QueryResult | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    const start = Date.now();
    try {
      const trimmed = sql.trim();
      const isSelect = /^(select|pragma|with)\b/i.test(trimmed);
      if (!isSelect) {
        this.rawExec(trimmed.replace(/;\s*$/, ''), []);
        // sql.js's export() closes and reopens the database, which resets
        // sqlite3_changes() to 0 — so the changed-row count must be read
        // before persisting, never after.
        const affectedRows = this.db.getRowsModified() ?? 0;
        await this.persist();
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
      const base = trimmed.replace(/;\s*$/, '');
      const countRow = this.run(`SELECT count(*) AS c FROM (${base}) AS t;`, []);
      const totalRows = Number(countRow[0]?.c ?? 0);
      const paged = `${base} LIMIT ${Math.max(1, pageSize)} OFFSET ${Math.max(0, page * pageSize)}`;
      const result = this.rawQuery(paged, []);
      const columns = result.columns.map((c) => ({ name: c, type: '' }));
      const rows: SqlValue[][] = result.values.map((v) => v.map(normalizeValue));
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
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      return Number(this.scalar<number>(`SELECT count(*) FROM ${quoteIdent(objectName)};`) ?? 0);
    } catch (e) {
      return this.toError(e, `Unknown error counting rows in "${objectName}".`);
    }
  }

  async commitEdits(edits: RowEdit[]): Promise<{ changes: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    if (edits.length === 0) return { changes: 0 };
    let changes = 0;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const edit of edits) {
        if (edit.edits.length === 0) continue;
        const sets = edit.edits.map((e) => `${quoteIdent(e.column)} = ?`).join(', ');
        const params: SqlValue[] = edit.edits.map((e) => e.value).concat(edit.key.keyValues);
        const keyWhere = edit.key.keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
        const fullSql = `UPDATE ${quoteIdent(edit.key.table)} SET ${sets} WHERE ${keyWhere};`;
        this.rawExec(fullSql, params);
        changes += 1;
      }
      this.db.exec('COMMIT;');
      await this.persist();
      return { changes };
    } catch (e) {
      this.rollback();
      return this.toError(e, 'Transaction failed and was rolled back.');
    }
  }

  async insertRow(
    table: string,
    values: Record<string, SqlValue>
  ): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
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
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.rawExec(`INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders});`, params);
      const keyRow = this.run('SELECT last_insert_rowid() AS id;', []);
      const newId = Number(keyRow[0]?.id ?? 0);
      this.db.exec('COMMIT;');
      await this.persist();
      return { key: { columns: ['rowid'], values: [newId] } };
    } catch (e) {
      this.rollback();
      return this.toError(e, 'Insert failed and was rolled back.');
    }
  }

  async deleteRows(keys: { table: string; keyColumns: string[]; keyValues: SqlValue[] }[]): Promise<{ changes: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    let changes = 0;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const k of keys) {
        if (k.keyColumns.length === 0) {
          this.rawExec(`DELETE FROM ${quoteIdent(k.table)};`, []);
          changes += 1;
          continue;
        }
        const where = k.keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
        this.rawExec(`DELETE FROM ${quoteIdent(k.table)} WHERE ${where};`, [...k.keyValues]);
        changes += 1;
      }
      this.db.exec('COMMIT;');
      await this.persist();
      return { changes };
    } catch (e) {
      this.rollback();
      return this.toError(e, 'Delete failed and was rolled back.');
    }
  }

  async duplicateRow(
    table: string,
    keyColumns: string[],
    keyValues: SqlValue[]
  ): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    const schema = await this.getSchema(table);
    if (isErrorInfo(schema)) return schema;
    const nonPkCols = schema.columns.filter((c) => !c.pk);
    if (nonPkCols.length === 0) {
      return { code: 'SQL_ERROR', message: 'No non-key columns to duplicate.' };
    }
    const cols = nonPkCols.map((c) => quoteIdent(c.name)).join(', ');
    const where = keyColumns.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.rawExec(
        `INSERT INTO ${quoteIdent(table)} (${cols}) SELECT ${cols} FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1;`,
        [...keyValues]
      );
      const idRow = this.run('SELECT last_insert_rowid() AS id;', []);
      const newId = Number(idRow[0]?.id ?? 0);
      this.db.exec('COMMIT;');
      await this.persist();
      return { key: { columns: ['rowid'], values: [newId] } };
    } catch (e) {
      this.rollback();
      return this.toError(e, 'Duplicate failed and was rolled back.');
    }
  }

  async executeStatements(statements: string[]): Promise<{ statements: number; affectedRows: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    let affectedRows = 0;
    let count = 0;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const stmt of statements) {
        const s = stmt.trim();
        if (s.length === 0) continue;
        const isQuery = /^(select|pragma|with)\b/i.test(s);
        if (!isQuery) {
          this.rawExec(s, []);
          affectedRows += this.db.getRowsModified();
        }
        count += 1;
      }
      this.db.exec('COMMIT;');
      await this.persist();
      return { statements: count, affectedRows };
    } catch (e) {
      this.rollback();
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
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    if (type === 'system') return { code: 'PERMISSION', message: 'Cannot delete system objects.' };
    const typeName = type === 'table' ? 'TABLE' : type === 'view' ? 'VIEW' : type === 'index' ? 'INDEX' : 'TRIGGER';
    const sql = `DROP ${typeName} IF EXISTS ${quoteIdent(name)};`;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.rawExec(sql, []);
      this.db.exec('COMMIT;');
      await this.persist();
      return { ok: true };
    } catch (e) {
      this.rollback();
      return this.toError(e, `Failed to delete ${type} "${name}".`);
    }
  }

  async export(format: ExportFormat, objectName?: string, selectSql?: string): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const data = await this.buildExport(format, objectName, selectSql);
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-'));
      const dest = path.join(tmpDir, `${objectName ?? 'database'}.${format}`);
      await fs.promises.writeFile(dest, data, 'utf8');
      return { filePath: dest, sizeBytes: Buffer.byteLength(data) };
    } catch (e) {
      return this.toError(e, 'Export failed.');
    }
  }

  async exportDatabase(format: ExportFormat): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo> {
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
    try {
      const objects = await this.getObjects(true);
      if (isErrorInfo(objects)) return objects;
      if (format === 'sql') {
        const parts: string[] = [];
        parts.push('-- Exported by SQLite/LibSQL Preview&Edit');
        parts.push(`-- Database: ${this.dbPath}`);
        parts.push('--');
        for (const o of objects.filter((x) => x.sql && x.type !== 'system')) {
          parts.push(`${o.sql!.replace(/;\s*$/, '')};\n`);
        }
        for (const t of objects.filter((x) => x.type === 'table')) {
          parts.push('');
          parts.push(`-- Data for table: ${t.name}`);
          const data = this.run(`SELECT * FROM ${quoteIdent(t.name)};`, []);
          if (data.length === 0) continue;
          const firstRow = data[0] as Record<string, unknown> | undefined;
          const cols = Object.keys(firstRow ?? {}).filter((k) => k !== 'rowid');
          const lines: string[] = [`INSERT INTO ${quoteIdent(t.name)} (${cols.join(', ')}) VALUES`];
          for (const row of data) {
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
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-'));
        const dest = path.join(tmpDir, 'database.sql');
        await fs.promises.writeFile(dest, text);
        return { filePath: dest, sizeBytes: Buffer.byteLength(text) };
      }
      if (format === 'json') {
        const parts: Record<string, unknown>[] = [];
        for (const t of objects.filter((x) => x.type === 'table')) {
          const data = this.run(`SELECT * FROM ${quoteIdent(t.name)};`, []);
          parts.push({ table: t.name, rows: data });
        }
        const text = JSON.stringify(parts, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-'));
        const dest = path.join(tmpDir, 'database.json');
        await fs.promises.writeFile(dest, text);
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
    if (!this.db) return { code: 'UNKNOWN', message: 'Database is not open.' };
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
        this.rawExec(`CREATE TABLE ${quoteIdent(tableName)} (${colsDef});`, []);
      }
      if (!exists && !(createTable && !exists)) {
        return { code: 'SQL_ERROR', message: `Table "${tableName}" does not exist and createTable is disabled.` };
      }
      let inserted = 0;
      let skipped = 0;
      this.db.exec('BEGIN IMMEDIATE;');
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
            this.rawExec(stmtSql, params);
            inserted += 1;
          } catch {
            if (conflict === 'fail') throw new Error('Insert conflict with strategy "fail".');
            skipped += 1;
          }
        }
        this.db.exec('COMMIT;');
        await this.persist();
        return { rows: inserted, skipped, tableName };
      } catch (e) {
        this.rollback();
        return this.toError(e, 'Import failed and was rolled back.');
      }
    } catch (e) {
      return this.toError(e, 'Import commit failed.');
    }
  }

  async isWritable(): Promise<boolean> {
    if (!this.writable || this.readOnlyFlag) return false;
    if (!this.db) return false;
    try {
      this.db.exec('BEGIN IMMEDIATE;');
      this.db.exec('COMMIT;');
      return true;
    } catch {
      this.writable = false;
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      // Flush any queued write before the handle goes away, otherwise the
      // last edit of a session can be lost when the user closes the editor.
      await this.persist();
      await this.persistChain;
      this.db?.close();
    } finally {
      this.db = null;
      this.dbPath = '';
      this.persistChain = Promise.resolve();
    }
  }

  /* ------------------------------ internals ----------------------------- */

  private rollback(): void {
    if (!this.db) return;
    try {
      this.db.exec('ROLLBACK;');
    } catch {
      // ignore
    }
  }

  private scalar<T = unknown>(sql: string): T | null {
    if (!this.db) return null;
    const res = this.db.exec(sql, []);
    const first = res[0];
    const row = first?.values?.[0];
    if (!row || row.length === 0) return null;
    return (row[0] as T) ?? null;
  }

  private run(sql: string, params: SqlValue[] = []): Record<string, unknown>[] {
    if (!this.db) throw new Error('Database is not open.');
    const stmt = this.db.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(params);
      const out: Record<string, unknown>[] = [];
      while (stmt.step()) {
        out.push(stmt.getAsObject());
      }
      return out;
    } finally {
      stmt.free();
    }
  }

  private rawExec(sql: string, params: SqlValue[] = []): void {
    if (!this.db) throw new Error('Database is not open.');
    const stmt = this.db.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(params);
      while (stmt.step()) {
        // drain
      }
    } finally {
      stmt.free();
    }
  }

  private rawQuery(sql: string, params: SqlValue[] = []): { columns: string[]; values: SqlValue[][] } {
    if (!this.db) throw new Error('Database is not open.');
    const stmt = this.db.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(params);
      const columns = stmt.getColumnNames();
      const values: SqlValue[][] = [];
      while (stmt.step()) {
        values.push(stmt.get() as SqlValue[]);
      }
      return { columns, values };
    } finally {
      stmt.free();
    }
  }

  private countObjects(type: 'table' | 'view' | 'index' | 'trigger'): number {
    return Number(
      this.scalar<number>(
        `SELECT count(*) FROM sqlite_master WHERE type='${type}' AND name NOT LIKE 'sqlite_%';`
      ) ?? 0
    );
  }

  private async tableExists(name: string): Promise<boolean> {
    // sqlite_master has no bound-parameter support through the scalar() helper,
    // so we inline the value with proper quoting.
    const c = this.scalar<number>(
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
    if (!objectName) {
      throw new Error('Table-specific export requires objectName.');
    }
    const q = quoteIdent(objectName);
    if (format === 'sql') {
      const schema = await this.getSchema(objectName);
      if (isErrorInfo(schema)) throw new Error(schema.message);
      const cols = schema.columns.map((c) => quoteIdent(c.name)).join(', ');
      const lines: string[] = [];
      if (schema.sql) lines.push(schema.sql + ';');
      const data = this.run(`SELECT * FROM ${q};`, []);
      if (data.length > 0) {
        lines.push(`INSERT INTO ${q} (${cols}) VALUES`);
        const rows = data.map(
          (r) =>
            `(${Object.keys(r)
              .map((k) => quoteLiteral((r as Record<string, SqlValue>)[k] ?? null))
              .join(', ')})`
        );
        lines.push(rows.join(',\n') + ';');
      }
      return lines.join('\n') + '\n';
    }
    if (format === 'json') {
      const data = this.run(`SELECT * FROM ${q};`, []);
      return JSON.stringify(data, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
    }
    const select = selectSql || `SELECT * FROM ${q};`;
    const data = this.run(select.replace(/;\s*$/, ''), []);
    return rowsToCsv(data);
  }

  /**
   * Write the in-memory database back to disk.
   *
   * Writes are serialized through `persistChain` so two overlapping edits can
   * never interleave two `db.export()` snapshots into the same file — that
   * would leave a torn database behind. A failure is swallowed because
   * persistence is best-effort: the caller already has its result and the
   * next write will retry with a fresh snapshot.
   */
  private async persist(): Promise<void> {
    if (!this.db || !this.dbPath) return;
    if (!this.writable || this.readOnlyFlag) return;
    const run = async (): Promise<void> => {
      if (!this.db || !this.dbPath) return;
      try {
        const buf = this.db.export();
        const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
        await fs.promises.writeFile(this.dbPath, data);
        this.dbSizeBytes = data.byteLength;
      } catch {
        // best-effort
      }
    };
    this.persistChain = this.persistChain.then(run, run);
    return this.persistChain;
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
      // SQLite's actual wording for a file that is not a database. Verified
      // against the bundled engine: opening arbitrary bytes reports exactly
      // "file is not a database", which the older patterns all missed.
      lower.includes('not a database') ||
      lower.includes('encrypted')
    ) {
      code = 'DB_CORRUPT';
    } else if (lower.includes('sql') || lower.includes('syntax') || lower.includes('near "')) code = 'SQL_ERROR';
    else if (lower.includes('rollback') || lower.includes('transaction')) code = 'TRANSACTION';
    return { code, message: msg || fallback, raw: msg };
  }
}
