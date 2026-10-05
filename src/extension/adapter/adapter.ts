// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ColumnInfo,
  DatabaseInfo,
  ErrorInfo,
  ExportFormat,
  ImportFieldMapping,
  ImportFormat,
  ObjectInfo,
  ObjectType,
  QueryResult,
  RowEdit,
  SqlValue
} from '../../shared/protocol';

/**
 * Abstraction over the SQL engine used by the extension.
 *
 * The extension talks to a database only through this interface. There is a
 * single implementation — the native LibSQL client (`libSqlAdapter.ts`) — which
 * covers both the LibSQL dialect and the plain SQLite baseline; the seam is
 * kept so host logic and the webview stay independent of that engine.
 *
 * Every method is async and returns a discriminated result: either the payload
 * on success, or an `ErrorInfo` describing a structured failure. The host never
 * throws across the boundary — it translates thrown errors into `ErrorInfo`
 * inside these methods so the webview always receives a well-formed message.
 */
export interface DatabaseAdapter {
  /** Open (or re-open) a database file. Returns the info after opening. */
  open(path: string): Promise<DatabaseInfo | ErrorInfo>;

  /** True when open() has produced a usable handle. */
  isOpen(): boolean;

  /** Basic statistics about the open database. */
  getInfo(): Promise<DatabaseInfo | ErrorInfo>;

  /** List tables, views, indexes, triggers (and optionally sqlite_* internals). */
  getObjects(includeHidden?: boolean): Promise<ObjectInfo[] | ErrorInfo>;

  /** Columns of a table/view, plus the CREATE statement. */
  getSchema(objectName: string): Promise<{ columns: ColumnInfo[]; sql: string } | ErrorInfo>;

  /** Execute a single statement, returning either a result set or an error. */
  query(sql: string, page: number, pageSize: number): Promise<QueryResult | ErrorInfo>;

  /** Count rows of a table (does not run a full scan when a stat exists). */
  rowCount(objectName: string): Promise<number | ErrorInfo>;

  /** Commit a batch of staged cell edits inside a single transaction. */
  commitEdits(edits: RowEdit[]): Promise<{ changes: number } | ErrorInfo>;

  /** Insert a single row (all column names must exist). */
  insertRow(table: string, values: Record<string, SqlValue>): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo>;

  /** Delete a batch of rows identified by their primary keys (or rowid). */
  deleteRows(keys: { table: string; keyColumns: string[]; keyValues: SqlValue[] }[]): Promise<{ changes: number } | ErrorInfo>;

  /** Duplicate a row, returning the key of the new row. */
  duplicateRow(table: string, keyColumns: string[], keyValues: SqlValue[]): Promise<{ key: { columns: string[]; values: SqlValue[] } } | ErrorInfo>;

  /** Execute a list of statements inside a single transaction. */
  executeStatements(statements: string[]): Promise<{ statements: number; affectedRows: number } | ErrorInfo>;

  /** Execute a single statement (e.g. an ad-hoc SELECT) and return the result. */
  executeSql(sql: string): Promise<QueryResult | ErrorInfo>;

  /** Execute DDL statements inside a single transaction; on failure roll back. */
  executeDdl(statements: string[]): Promise<{ statements: number } | ErrorInfo>;

  /** Drop a table/view/index/trigger. */
  deleteObject(name: string, type: ObjectType): Promise<{ ok: true } | ErrorInfo>;

  /**
   * Export a table or the whole database.
   *
   * `destPath` is where the file is written. The host supplies it from a save
   * dialog so the USER chooses the location; when it is omitted (programmatic
   * callers and tests) a temporary file is created and its path returned — which
   * is why callers must always use the returned `filePath`, never assume one.
   */
  export(format: ExportFormat, objectName?: string, selectSql?: string, destPath?: string): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo>;

  /** Export the entire database to a file. `destPath` as in `export`. */
  exportDatabase(format: ExportFormat, destPath?: string): Promise<{ filePath: string; sizeBytes: number } | ErrorInfo>;

  /** Inspect an external CSV/JSON file for import mapping. */
  importPreview(filePath: string, format: ImportFormat): Promise<{ headers: string[]; mappings: ImportFieldMapping[]; previewRows: SqlValue[][] } | ErrorInfo>;

  /** Run the configured import after the user confirms the mapping. */
  importCommit(filePath: string, tableName: string, mappings: ImportFieldMapping[], conflict: 'skip' | 'replace' | 'fail', createTable: boolean): Promise<{ rows: number; skipped: number; tableName: string } | ErrorInfo>;

  /** Check whether the database is currently writable. */
  isWritable(): Promise<boolean>;

  /** Close the database and free resources. */
  close(): Promise<void>;

  /**
   * True when the open file was detected as LibSQL. Optional so an adapter
   * that only speaks the SQLite baseline can omit it; the host falls back to
   * the `engine` field on DatabaseInfo.
   */
  isLibSql?(): boolean;

  /** Report the name of the driver implementation running the queries. */
  readonly driverName: string;
}
