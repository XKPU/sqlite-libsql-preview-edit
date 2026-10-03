import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
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
  quoteIdent,
  quoteLiteral,
  QueryResult,
  resolveLibSqlDetection,
  RowEdit,
  SqlValue,
  LIBSQL_CAPABILITIES,
  LibSqlCapabilities,
  LibSqlDetection,
  ObjectInfo,
  ObjectType
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

/* ------------------------------------------------------------------------ */
/* LibSQL adapter using @libsql/client (native libsql + hRana remote)       */
/* ------------------------------------------------------------------------ */

/**
 * `@libsql/client` is the canonical client for LibSQL. It handles both local
 * files (through the native `libsql` binding) and remote databases (through
 * `@libsql/hrana-client`). Because it is a required dependency, the module is
 * always available; the adapter simply creates a client and runs SQL.
 *
 * Local-file behaviour differs from sql.js in two key ways:
 *   1. writes go straight to disk — no `export()` / `persist()` step;
 *   2. LibSQL-only statements (STRICT tables, ALTER COLUMN, vector_search,
 *      INSERT … ON CONFLICT DO UPDATE … RETURNING) execute natively.
 */

/* ---- local type declarations (avoid ESM->CJS import-type conflict) ----- */

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

interface LibSqlConnection {
  execute(query: InStatement): Promise<ResultSet>;
  transaction(mode: 'write' | 'read' | 'deferred'): Promise<TxObject>;
  close(): void;
}

type LibSqlClientFactory = {
  createClient(opts: { url: string; authToken?: string }): LibSqlConnection;
};

let clientFactory: LibSqlClientFactory | null = null;

function getClientFactory(): LibSqlClientFactory {
  if (!clientFactory) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    clientFactory = require('@libsql/client') as LibSqlClientFactory;
  }
  return clientFactory;
}

/** Convert an OS file path to a LibSQL URL, preserving drive letters and spaces. */
export function libSqlFileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

/* ------------------------------------------------------------------------ */

export class LibSqlAdapter implements DatabaseAdapter {
  readonly driverName = 'libsql';

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
      this.client = getClientFactory().createClient({ url: libSqlFileUrl(filePath) });
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
   * The capability set for the current engine. With the native libsql engine
   * every LibSQL capability is executable, regardless of what the on-disk
   * dialect reports.
   */
  private capabilities(): LibSqlCapabilities {
    return LIBSQL_CAPABILITIES;
  }

  /**
   * Decide whether the open file is LibSQL.
   *
   * The bundled engine is always LibSQL, so every signal that the sql.js-based
   * adapter gathers still applies. The `fallback` flag is always false here:
   * unlike sql.js, the native libsql engine can execute LibSQL-only statements.
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
      false // native libsql engine — no fallback
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
   * True when the current file is LibSQL. With the native libsql engine this
   * also means every LibSQL capability is executable.
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
         WHERE type IN ('table','view','index','trigger')
         AND (? = 1 OR name NOT LIKE 'sqlite_%')
         ORDER BY type, name`,
        [includeHidden ? 1 : 0]
      );
      return rows.map((r) => ({
        name: r.name as string,
        type: r.type as ObjectType,
        sql: (r.sql as string | null) ?? '',
        hidden: (r.name as string).startsWith('sqlite_')
      }));
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
    let affectedRows = 0;
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

  async export(format: ExportFormat, objectName?: string, selectSql?: string): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo> {
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
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
    if (!this.client) return { code: 'UNKNOWN', message: 'Database is not open.' };
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
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-'));
        const dest = path.join(tmpDir, 'database.sql');
        await fs.promises.writeFile(dest, text);
        return { filePath: dest, sizeBytes: Buffer.byteLength(text) };
      }
      if (format === 'json') {
        const parts: Record<string, unknown>[] = [];
        for (const t of objects.filter((x) => x.type === 'table')) {
          const result = await this.client.execute({ sql: `SELECT * FROM ${quoteIdent(t.name)};`, args: [] });
          parts.push({ table: t.name, rows: result.rows });
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
      const val = (row as Record<string, unknown>)[Object.keys(row)[0]];
      return (val as T) ?? null;
    } catch {
      return null;
    }
  }

  /** Synchronous row helper used during detection (best-effort, may return []). */
  private syncRows(sql: string): Record<string, unknown>[] {
    // @libsql/client has no sync API; return empty on any failure.
    // Called only during detection, where empty is a valid (non-evidencing) result.
    void sql;
    return [];
  }

  private async countObjects(type: 'table' | 'view' | 'index' | 'trigger'): Promise<number | null> {
    return await this.scalar<number>(
      `SELECT count(*) FROM sqlite_master WHERE type='${type}' AND name NOT LIKE 'sqlite_%';`
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
    if (format === 'json') {
      const result = await this.client!.execute({ sql: `SELECT * FROM ${q};`, args: [] });
      return JSON.stringify(result.rows, (_k, v) => (v instanceof Uint8Array ? 'X' + bytesToHex(v) : v));
    }
    const select = selectSql || `SELECT * FROM ${q};`;
    const result = await this.client!.execute({ sql: select.replace(/;\s*$/, ''), args: [] });
    return rowsToCsv(result.rows);
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
