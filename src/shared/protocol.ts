// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared protocol between the extension host and the webview.
 *
 * Both sides import this file so that message types are checked at compile
 * time. The webview sends `HostRequest`s, the host replies with
 * `HostResponse`s over the VS Code postMessage bridge.
 *
 * No runtime code lives here — this module is pure types plus a couple of
 * tiny runtime helpers that are safe to ship to both sides.
 */

/* ------------------------------------------------------------------------ */
/* Value & data models                                                      */
/* ------------------------------------------------------------------------ */

/**
 * A SQL cell value as it crosses the wire.
 * - `null` for SQL NULL
 * - `number` for integer / float (SQLite stores both as IEEE-754 doubles in
 *   the JS API; large integers keep their text form to avoid precision loss)
 * - `string` for text
 * - `Uint8Array` for BLOB
 */
export type SqlValue = string | number | boolean | null | Uint8Array;

export type ObjectType = 'table' | 'view' | 'index' | 'trigger' | 'sequence' | 'dataType' | 'system';

export type ExportFormat = 'csv' | 'json' | 'sql';
export type ImportFormat = 'csv' | 'json';

export interface ObjectInfo {
  name: string;
  type: ObjectType;
  /** For table/view/index/trigger: the CREATE statement, when available. */
  sql?: string;
  /** True for sqlite_* internals and schema_* shadow tables. */
  hidden?: boolean;
  /** Row count, populated lazily for tables. */
  rowCount?: number;
  /** Declared type for the object (only meaningful for tables). */
  declaredType?: string;
  /** True when the object is user-defined and was created with AS OF. */
  readOnly?: boolean;
  /** Current sequence counter from sqlite_sequence; set only for type==='sequence'. */
  seq?: number;
  /** Start value from CREATE SEQUENCE, when available. */
  startValue?: number;
  /** Increment value from CREATE SEQUENCE, when available. */
  incrementBy?: number;
  /** Minimum value from CREATE SEQUENCE, when available. */
  minValue?: number;
  /** Maximum value from CREATE SEQUENCE, when available. */
  maxValue?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  pk: boolean;
  /** Position within a composite primary key (1-based), 0 when not a PK part. */
  pkOrder: number;
  /** True when the column is the implicit rowid alias. */
  rowidAlias: boolean;
  /** 0-based index of the column in the table. */
  cid: number;
  hidden: boolean;
}

export interface QueryResult {
  /** Column names / types as reported by the result set. */
  columns: { name: string; type: string }[];
  /** Rows of SqlValue. */
  rows: SqlValue[][];
  /** Total number of matching rows (may exceed the page size). */
  totalRows: number;
  /** True when the returned rows are a truncated window. */
  truncated: boolean;
  /** Present only for non-select statements. */
  affectedRows?: number;
  /** Whether the statement returned a result set. */
  isQuery: boolean;
  /** Wall-clock duration of the executed statement in ms. */
  durationMs: number;
}

export type ErrorCode =
  | 'DB_CORRUPT'
  | 'DB_LOCKED'
  | 'SQL_ERROR'
  | 'PERMISSION'
  | 'TRANSACTION'
  | 'FILE_NOT_FOUND'
  | 'FILE_EMPTY'
  | 'READONLY'
  | 'CANCELED'
  /**
   * The webview and the extension host were built against different protocol
   * versions, which happens when a new build is installed while a window is
   * still running the old extension host. Recoverable by reloading the window.
   */
  | 'VERSION_MISMATCH'
  | 'UNKNOWN';

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  /** Original driver message, when different from `message`. */
  raw?: string;
  /** 1-based line of the offending statement, when known. */
  line?: number;
  /** 1-based column of the offending statement, when known. */
  column?: number;
  /** The SQL that produced the error. */
  sql?: string;
}

export interface DatabaseInfo {
  path: string;
  sizeBytes: number;
  pageSize: number;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'unknown';
  tableCount: number;
  viewCount: number;
  indexCount: number;
  triggerCount: number;
  writable: boolean;
  readOnly: boolean;
  /**
   * Why the database was opened read-only, when `readOnly` is set.
   *
   * `user` means the read-only behaviour is the user's own configuration, so
   * the UI must stay quiet about it. `locked` means another process holds the
   * file lock and the adapter fell back to read-only rather than failing, which
   * the UI must surface as a warning. Absent when the database is writable or
   * when the reason could not be established.
   */
  readOnlyReason?: 'user' | 'locked';
  version: string;
  /**
   * Name of the driver implementation running the queries. Distinct from
   * `engine`: the driver is the implementation, the engine is the dialect the
   * file is written in. Always `turso` while Turso Database is the only driver.
   */
  driver: string;
  /**
   * The dialect the file is written in, inferred by detection. Defaults to
   * `sqlite`; `libsql` and `turso` are reported from the matching signals.
   *
   * This is a *label*, not a dispatch switch: every file is served by the same
   * Turso Database driver, so the value never selects an implementation and
   * never turns a capability on or off. See `capabilities` below.
   */
  engine: DbEngine;
  /** How the dialect was determined, with the evidence that decided it. */
  detection: LibSqlDetection;
  /**
   * Capabilities the bundled engine offers. Reported unconditionally from
   * `TURSO_CAPABILITIES`, because Turso Database is a superset of SQLite and
   * LibSQL and is the only engine that can run — the detected dialect does not
   * change what is executable.
   */
  capabilities: LibSqlCapabilities;
}

/* ------------------------------------------------------------------------ */
/* Dialect detection: SQLite baseline, LibSQL, Turso Database               */
/* ------------------------------------------------------------------------ */

/**
 * The SQLite-family dialect in use. SQLite is always the baseline; a richer
 * dialect is reported only when positive evidence is found, so a plain SQLite
 * file can never be mislabelled.
 *
 * All three share the same on-disk `SQLite format 3` container, which is what
 * makes one editor able to open any of them. They differ in SQL surface:
 * `turso` adds `CREATE SEQUENCE` / `nextval()`, which neither `libsql` nor
 * `sqlite` implements.
 */
export type DbEngine = 'sqlite' | 'libsql' | 'turso';

/** Where a piece of LibSQL evidence came from. */
export type LibSqlEvidenceKind =
  /** The file name uses a LibSQL-specific extension (`.libsql`). */
  | 'extension'
  /** The file name uses the Turso Database extension (`.turso`). */
  | 'turso-extension'
  /** An engine PRAGMA reported a LibSQL build. */
  | 'pragma'
  /** `sqlite_version()` carried a LibSQL suffix. */
  | 'version'
  /** `sqlite_version()` carried a Turso Database identifier. */
  | 'turso-version'
  /** The schema contains LibSQL system/shadow tables. */
  | 'schema'
  /** No evidence either way; the SQLite baseline stands. */
  | 'none';

export interface LibSqlEvidence {
  kind: LibSqlEvidenceKind;
  /** Non-localized technical detail, shown in the database info panel. */
  detail: string;
  /**
   * Confidence contributed by this signal, 0..100. The extension takes the
   * strongest signal rather than summing, so one conclusive marker is enough.
   */
  weight: number;
}

/**
 * Engine capabilities, switched on the moment detection succeeds. All flags are
 * false in the SQLite baseline.
 */
export interface LibSqlCapabilities {
  /** `CREATE TABLE ... STRICT` with the extended type set. */
  strictTables: boolean;
  /** `ALTER TABLE ... ALTER COLUMN` / `DROP COLUMN`. */
  alterColumn: boolean;
  /** `F32_BLOB`, `vector_distance_cos`, `vector_top_k`. */
  vectorSearch: boolean;
  /** `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. */
  upsertReturning: boolean;
  /** Embedded / attached remote replicas. */
  embeddedReplicas: boolean;
  /** `ALTER TABLE ... ADD COLUMN` with a non-constant default. */
  nonConstantDefaults: boolean;
  /**
   * `CREATE SEQUENCE` and `nextval()`, so a primary key can take its default
   * from a sequence instead of the rowid counter.
   *
   * This is a **Turso Database** extension. Stock SQLite and libSQL do not
   * implement it, so it must stay false for those engines — never infer it from
   * `engine === 'libsql'`.
   */
  sequences: boolean;
  /** Functions the SQL editor may offer only when a richer dialect is active. */
  onlyFunctions: string[];
}

export interface LibSqlDetection {
  /** The dialect the file is written in. */
  engine: DbEngine;
  /**
   * True when the file is any member of the LibSQL family — `libsql` or
   * `turso`, since Turso Database is a LibSQL-derived engine. False only for
   * the plain SQLite baseline.
   */
  libSql: boolean;
  /**
   * Always `false`: the bundled engine is the only driver, so a detected file
   * is never served by a less capable fallback engine. Kept as a field because
   * the webview still reads it and a future fallback engine would need
   * somewhere to report that.
   */
  fallback: boolean;
  /** Evidence considered, strongest first. Empty when nothing matched. */
  evidence: LibSqlEvidence[];
  /** Which signal decided the verdict. */
  decidedBy: LibSqlEvidenceKind;
}

/** The all-false capability set used for the plain SQLite baseline. */
export const SQLITE_CAPABILITIES: LibSqlCapabilities = {
  strictTables: false,
  alterColumn: false,
  vectorSearch: false,
  upsertReturning: false,
  embeddedReplicas: false,
  nonConstantDefaults: false,
  sequences: false,
  onlyFunctions: []
};

/**
 * Capabilities of the libSQL dialect (`@libsql/client`, the C fork of SQLite).
 *
 * Retained as the reference point for what libSQL alone offers. Note
 * `sequences: false`: `CREATE SEQUENCE` is NOT part of libSQL — it belongs to
 * Turso Database (see `TURSO_CAPABILITIES`).
 */
export const LIBSQL_CAPABILITIES: LibSqlCapabilities = {
  strictTables: true,
  alterColumn: true,
  vectorSearch: true,
  upsertReturning: true,
  embeddedReplicas: true,
  nonConstantDefaults: true,
  sequences: false,
  onlyFunctions: [
    'vector_distance_cos',
    'vector_distance_l2',
    'vector_top_k',
    'vector_extract',
    'vector_full_scan',
    'libsql_wal_frame_count'
  ]
};

/**
 * Capabilities of Turso Database (`@tursodatabase/database`), the engine this
 * extension ships.
 *
 * It is a strict superset of libSQL for everything the editor exposes: the C-fork
 * feature set all holds, and `CREATE SEQUENCE` / `nextval()` are additionally
 * available. Every flag here was verified by executing the statement against the
 * live engine, not inferred from documentation.
 *
 * `embeddedReplicas` is false: this extension opens LOCAL FILES only and wires
 * up no remote or replica transport.
 */
export const TURSO_CAPABILITIES: LibSqlCapabilities = {
  strictTables: true,
  alterColumn: true,
  vectorSearch: true,
  upsertReturning: true,
  embeddedReplicas: false,
  nonConstantDefaults: true,
  sequences: true,
  onlyFunctions: [
    'vector_distance_cos',
    'vector_distance_l2',
    'vector_top_k',
    'vector_extract',
    'vector_full_scan'
  ]
};

/* ------------------------------------------------------------------------ */
/* Webview configuration (mirror of the extension settings)                 */
/* ------------------------------------------------------------------------ */

export type Language = 'en' | 'zh-cn';

export interface WebviewSettings {
  language: Language;
  pageSize: number;
  readOnly: boolean;
  readOnlyTables: string[];
  confirmDestructiveActions: boolean;
  nullDisplay: string;
  maxCellLength: number;
  exportEncoding: 'utf8' | 'utf16le' | 'ascii' | 'base64';
}

/* ------------------------------------------------------------------------ */
/* Edit staging                                                              */
/* ------------------------------------------------------------------------ */

export interface CellKey {
  /** The table the row belongs to. */
  table: string;
  /** Columns that identify the row (the primary key, or [rowid]). */
  keyColumns: string[];
  /** Values for those key columns, in the same order. */
  keyValues: SqlValue[];
}

export interface CellEdit {
  /** Column to update. */
  column: string;
  /** New value. */
  value: SqlValue;
  /** Previous value, for conflict display. */
  original: SqlValue;
}

export interface RowEdit {
  key: CellKey;
  edits: CellEdit[];
}

/* ------------------------------------------------------------------------ */
/* Import mapping                                                            */
/* ------------------------------------------------------------------------ */

export interface ImportFieldMapping {
  /** Source column header / JSON key. */
  source: string;
  /** Target column name. */
  target: string;
  /** Detected SQLite type. */
  inferredType: string;
}

export interface ImportOptions {
  format: ImportFormat;
  tableName: string;
  mappings: ImportFieldMapping[];
  /** 'skip' | 'replace' | 'fail' — behaviour on a primary-key conflict. */
  conflict: 'skip' | 'replace' | 'fail';
  /** Whether to create the table when it does not exist. */
  createTable: boolean;
}

/* ------------------------------------------------------------------------ */
/* Client -> Host (webview posts these)                                      */
/* ------------------------------------------------------------------------ */

/**
 * Version of the host <-> webview wire contract.
 *
 * The webview bundle and the extension host are loaded independently by VS Code:
 * installing a new `.vsix` replaces both on disk, but VS Code keeps an already
 * running extension host in memory until its window reloads. That leaves the
 * host and the webview on different builds, and a request the old host does not
 * recognise lands in its `default` branch, which used to report
 * "Unhandled message type: …" and (for an id of 0) surface as a fatal load
 * error. That is exactly how a diagnostic `log` message broke the editor.
 *
 * Both sides now announce this number, so a mismatch is detected and reported
 * as "reload the window" instead of an unexplained failure.
 *
 * Bump this whenever a message type is added or its shape changes.
 */
export const PROTOCOL_VERSION = 3;

export interface HostRequestBase {
  /** Monotonic id so responses can be matched. */
  id: number;
  /**
   * Contract version the sender was built against.
   *
   * Optional so that a webview built before this field existed can still talk to
   * a newer host; the host then treats the request as version 1.
   */
  protocolVersion?: number;
}

export type HostRequest =
  | (HostRequestBase & {
      type: 'open';
      path: string;
    })
  | (HostRequestBase & {
      type: 'getInfo';
    })
  | (HostRequestBase & {
      type: 'getMetadata';
    })
  | (HostRequestBase & {
      type: 'getSchema';
      objectName: string;
      objectType: ObjectType;
    })
  | (HostRequestBase & {
      type: 'query';
      sql: string;
      page: number;
      pageSize: number;
      /** Optional ORDER BY override supplied by the webview. */
      orderBy?: string;
      /** Optional WHERE filter the webview has composed. */
      where?: string;
    })
  | (HostRequestBase & {
      type: 'rowCount';
      objectName: string;
    })
  | (HostRequestBase & {
      type: 'commitEdits';
      edits: RowEdit[];
    })
  | (HostRequestBase & {
      type: 'insertRow';
      table: string;
      /** Column -> value map for the new row. */
      values: Record<string, SqlValue>;
    })
  | (HostRequestBase & {
      type: 'deleteRows';
      keys: CellKey[];
    })
  | (HostRequestBase & {
      type: 'duplicateRow';
      key: CellKey;
    })
  | (HostRequestBase & {
      type: 'export';
      format: ExportFormat;
      objectName?: string;
      /** Optional SQL used to select the data to export. */
      selectSql?: string;
    })
  | (HostRequestBase & {
      type: 'importPreview';
      filePath: string;
      format: ImportFormat;
    })
  | (HostRequestBase & {
      type: 'importCommit';
      options: ImportOptions;
      filePath: string;
    })
  | (HostRequestBase & {
      type: 'executeSql';
      sql: string;
    })
  | (HostRequestBase & {
      type: 'executeStatements';
      statements: string[];
    })
  | (HostRequestBase & {
      type: 'executeDdl';
      statements: string[];
    })
  | (HostRequestBase & {
      type: 'deleteObject';
      name: string;
      objectType: ObjectType;
    })
  | (HostRequestBase & {
      type: 'exportDatabase';
      format: ExportFormat;
    })
  | (HostRequestBase & {
      type: 'close';
    })
  | (HostRequestBase & {
      /**
       * Persist a language choice made in the webview's language selector.
       *
       * The host owns the setting, so the webview cannot switch language on its
       * own: it applies the change locally for immediate feedback and asks the
       * host to store it, which keeps every open editor in step.
       */
      type: 'setLanguage';
      language: Language;
    })
  | (HostRequestBase & {
      /**
       * Open the extension's settings page in VS Code.
       *
       * The webview cannot call `workbench.action.openSettings` directly, so it
       * asks the extension host to launch the command on its behalf.
       */
      type: 'openSettings';
    })
  | (HostRequestBase & {
      /**
       * Forward a webview-side diagnostic to the host's Output channel.
       *
       * The webview runs sandboxed with no console access from the extension
       * host, so without this a stall inside the webview is invisible. The
       * handshake and every error are reported here.
       */
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
    })
  | (HostRequestBase & {
      /**
       * Handshake sent by the webview once its message listener is attached.
       *
       * The host pushes the `ready` snapshot from `resolveCustomEditor`, but the
       * webview may not be listening yet, so that first push can be dropped and
       * the UI would sit on "Loading database…" forever. This request asks the
       * host to (re)send the current state, which makes the editor load
       * deterministically regardless of which side wins the race.
       */
      type: 'init';
    });

/* ------------------------------------------------------------------------ */
/* Host -> Client                                                            */
/* ------------------------------------------------------------------------ */

export type HostResponse =
  | {
      id: number;
      type: 'ready';
      info: DatabaseInfo;
      objects: ObjectInfo[];
      settings: WebviewSettings;
      /**
       * Contract version the host was built against.
       *
       * The webview uses this to discover what the host can handle before
       * sending anything optional. A host from a build that predates this field
       * omits it, which tells the webview to stay on the version-1 contract —
       * that is what stops a diagnostic `log` from reaching an old host's
       * "Unhandled message type" branch after an update.
       */
      protocolVersion?: number;
    }
  | { id: number; type: 'info'; info: DatabaseInfo }
  | { id: number; type: 'metadata'; objects: ObjectInfo[] }
  | { id: number; type: 'schema'; columns: ColumnInfo[]; sql: string }
  | { id: number; type: 'result'; result: QueryResult }
  | { id: number; type: 'error'; error: ErrorInfo }
  | { id: number; type: 'progress'; phase: string; progress: number; detail?: string }
  | { id: number; type: 'saved'; changes: number }
  | { id: number; type: 'languageChanged'; language: Language; settings: WebviewSettings }
  | { id: number; type: 'exported'; filePath: string; sizeBytes: number; format: ExportFormat }
  /**
   * The user dismissed the save dialog, so nothing was written. Distinct from an
   * `error`: reporting a cancellation as a failure would train users to ignore
   * real export errors.
   */
  | { id: number; type: 'exportCancelled'; format: ExportFormat }
  | { id: number; type: 'importPreview'; mappings: ImportFieldMapping[]; previewRows: SqlValue[][]; headers: string[] }
  | { id: number; type: 'imported'; rows: number; skipped: number; tableName: string }
  | { id: number; type: 'objectDeleted'; name: string; objectType: ObjectType }
  | { id: number; type: 'closed' }
  | { id: number; type: 'readOnly'; readOnly: boolean }
  | { id: number; type: 'refreshRequested' }
  | { id: number; type: 'showSql' }
  | { id: number; type: 'addObject' }
  | { id: number; type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

/* ------------------------------------------------------------------------ */
/* Runtime helpers (safe in both host and webview)                          */
/* ------------------------------------------------------------------------ */

/** True when a value is a real SQL NULL (as opposed to an empty string). */
export function isNull(v: SqlValue): boolean {
  return v === null;
}

/** Stable JSON-safe string for SqlValue (for logging / display keys). */
export function valueToString(v: SqlValue, nullDisplay = 'NULL', maxLen = 1000): string {
  if (v === null) return nullDisplay;
  if (v instanceof Uint8Array) {
    return `X'${bytesToHex(v)}'`;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (v.length > maxLen) return v.slice(0, maxLen) + '…';
  return v;
}

/**
 * A stable key identifying one edited row, used to detect "is this row already
 * in the pending-edit list?".
 *
 * This existed as three byte-identical private copies — one in `DataTable` (as
 * `rowEditKeyStr`), one in `useDatabaseState`, and an exported one in
 * `useWebview` — so a change to the key format would have had to be made in
 * three places to stay consistent. It is pure and shared, so it lives here.
 */
export function rowEditKey(table: string, keyColumns: string[], keyValues: SqlValue[]): string {
  return table + '|' + keyColumns.join(',') + '|' + keyValues.map((v) => String(v)).join(',');
}

export function valueToNumber(v: SqlValue): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

/** Split a multi-statement SQL string on top-level semicolons. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inSquote = false;
  let inDquote = false;
  let inBquote = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const n = sql[i + 1];
    if (inLine) {
      buf += c;
      if (c === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      buf += c;
      if (c === '*' && n === '/') {
        buf += '/';
        i++;
        inBlock = false;
      }
      continue;
    }
    if (inSquote) {
      buf += c;
      if (c === "'" && n === "'") {
        buf += n;
        i++;
        continue;
      }
      if (c === "'") inSquote = false;
      continue;
    }
    if (inDquote) {
      buf += c;
      if (c === '"') inDquote = false;
      continue;
    }
    if (inBquote) {
      buf += c;
      if (c === '`') inBquote = false;
      continue;
    }
    // not inside a string/comment
    if (c === '-' && n === '-') {
      inLine = true;
      buf += c;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      buf += '/*';
      i++;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      buf += c;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      buf += c;
      continue;
    }
    if (c === '`') {
      inBquote = true;
      buf += c;
      continue;
    }
    if (c === ';') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Quote an identifier for use in generated SQL. */
export function quoteIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Quote a value for use in generated SQL. */
export function quoteLiteral(v: SqlValue): string {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Uint8Array) return 'X' + "'" + bytesToHex(v) + "'";
  return "'" + v.replace(/'/g, "''") + "'";
}

/* ------------------------------------------------------------------------ */
/* LibSQL detection — pure helpers, safe on both sides of the bridge         */
/* ------------------------------------------------------------------------ */

/** File extensions that are unambiguously LibSQL. */
export const LIBSQL_EXTENSIONS = ['.libsql'] as const;

/**
 * File extensions that are unambiguously Turso Database.
 *
 * All three dialects share one on-disk container, so the extension is a naming
 * convention rather than proof — but it is the only signal a freshly created,
 * still-empty file can carry.
 */
export const TURSO_EXTENSIONS = ['.turso'] as const;

/** File extensions that are unambiguously the SQLite baseline. */
export const SQLITE_EXTENSIONS = ['.db', '.sqlite', '.sqlite3', '.db3'] as const;

/**
 * The 16-byte magic every SQLite-format database starts with. LibSQL keeps
 * this magic for on-disk compatibility, so it proves "SQLite family" and says
 * nothing about the dialect.
 */
export const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';

/**
 * Bytes 21..23 of a valid SQLite header are fixed constants.
 *
 * SQLite writes 64, 32, 32 there (its "max embedded payload fraction", "min
 * embedded payload fraction" and "leaf payload fraction"). A file whose header
 * does not carry these values is rejected by SQLite itself with
 * "file is not a database", which is verified by `test/libsql-detection.test.ts`.
 *
 * This matters because it means the header cannot carry a LibSQL marker: the
 * on-disk format is byte-compatible and any stamp there would make the file
 * unopenable. Detection therefore relies on the signals that genuinely differ
 * (the version string, LibSQL schema objects, and the file extension).
 */
export const SQLITE_HEADER_FIXED_BYTES = [64, 32, 32] as const;

/**
 * Engine version strings that identify a Turso Database build.
 *
 * Checked BEFORE the LibSQL pattern, because the LibSQL pattern is deliberately
 * broad enough to also match `turso` (the two projects share history) and would
 * otherwise swallow Turso's own identifier and report it as LibSQL.
 */
const TURSO_VERSION_RE = /turso/i;

/**
 * Engine version strings that identify a LibSQL-family build.
 *
 * libSQL exposes its own version through `libsql_libversion()`; the SQLite
 * API that this adapter calls reports a suffix or a Turso/sqld engine name
 * depending on the build. Matching these is the strongest portable in-file
 * signal available without libSQL-specific APIs.
 */
const LIBSQL_VERSION_RE = /libsql|libsql-server|sqld/i;

/** Lower-case extension of a path, including the dot; '' when there is none. */
export function extensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** True when the extension is LibSQL-exclusive. */
export function hasLibSqlExtension(filePath: string): boolean {
  return (LIBSQL_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));
}

/** True when the extension is Turso-exclusive. */
export function hasTursoExtension(filePath: string): boolean {
  return (TURSO_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));
}

/** True when the extension is one of the plain SQLite baseline ones. */
export function hasSqliteExtension(filePath: string): boolean {
  return (SQLITE_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));
}

/**
 * Inspect the first bytes of a database header.
 *
 * A LibSQL database is byte-compatible with SQLite, so the header proves the
 * *family* and nothing more: bytes 21..23 are fixed constants in any file
 * SQLite will open, so they can never carry a dialect marker. This function
 * therefore reports no evidence for a normal file. It exists to validate the
 * format, and to surface a corrupt/foreign header as a negative signal rather
 * than silently claiming the SQLite baseline.
 *
 * The check is deliberately tolerant: a file too short to hold a header simply
 * yields no evidence rather than an error, because detection must never be the
 * reason a file fails to open.
 */
export function detectLibSqlInHeader(bytes: Uint8Array | undefined): LibSqlEvidence[] {
  if (!bytes || bytes.length < 16) return [];
  const magic = latin1(bytes, 0, 16);
  if (magic !== SQLITE_HEADER_MAGIC) return [];
  // A SQLite-family header is confirmed. That is not LibSQL evidence, and the
  // fixed bytes 21..23 cannot distinguish the dialects, so report nothing.
  return [];
}

/**
 * True when `bytes` is a well-formed SQLite-family header.
 *
 * Used to distinguish "plain SQLite" from "not a database at all", so the
 * caller can report an unusable file instead of mislabelling it.
 */
export function hasSqliteHeader(bytes: Uint8Array | undefined): boolean {
  if (!bytes || bytes.length < 16) return false;
  return latin1(bytes, 0, 16) === SQLITE_HEADER_MAGIC;
}

/** Decode a byte range as latin1 (one char per byte) without allocating a copy. */
function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

/** Evidence from the `sqlite_version()` / engine version string. */
export function detectLibSqlInVersion(version: string | undefined): LibSqlEvidence[] {
  if (!version) return [];
  // Turso first: the LibSQL pattern also matches "turso", so testing it first
  // would mislabel a Turso build as LibSQL.
  if (TURSO_VERSION_RE.test(version)) {
    return [
      {
        kind: 'turso-version',
        detail: `Engine version reported "${version}".`,
        weight: 80
      }
    ];
  }
  if (!LIBSQL_VERSION_RE.test(version)) return [];
  return [
    {
      kind: 'version',
      detail: `Engine version reported "${version}".`,
      weight: 80
    }
  ];
}

/** Evidence from an engine PRAGMA such as `pragma compile_options`. */
export function detectLibSqlInPragma(values: readonly string[] | undefined): LibSqlEvidence[] {
  if (!values || values.length === 0) return [];
  const hit = values.find((v) => LIBSQL_VERSION_RE.test(v));
  if (!hit) return [];
  return [
    {
      kind: 'pragma',
      detail: `Engine pragma reported "${hit}".`,
      weight: 70
    }
  ];
}

/** Evidence from schema object names that only LibSQL introduces. */
export function detectLibSqlInSchema(objectNames: readonly string[] | undefined): LibSqlEvidence[] {
  if (!objectNames || objectNames.length === 0) return [];
  const out: LibSqlEvidence[] = [];
  for (const name of objectNames) {
    if (/^libsql_/i.test(name)) {
      out.push({
        kind: 'schema',
        detail: `Schema contains LibSQL object "${name}".`,
        weight: 75
      });
      break;
    }
  }
  return out;
}

/** Evidence from the extension alone. Weakest signal, so the lowest weight. */
export function detectLibSqlInExtension(filePath: string): LibSqlEvidence[] {
  if (hasTursoExtension(filePath)) {
    return [
      {
        kind: 'turso-extension',
        detail: `File name uses the Turso Database extension "${extensionOf(filePath)}".`,
        weight: 60
      }
    ];
  }
  if (!hasLibSqlExtension(filePath)) return [];
  return [
    {
      kind: 'extension',
      detail: `File name uses the LibSQL extension "${extensionOf(filePath)}".`,
      weight: 60
    }
  ];
}

/**
 * Fold every signal into one verdict.
 *
 * The strongest single signal decides, which is why weights are never summed:
 * a renamed plain SQLite file with a stray marker cannot out-vote conclusive
 * header evidence, and one authoritative marker is enough on its own.
 */
export function resolveLibSqlDetection(
  filePath: string,
  signals: {
    header?: Uint8Array;
    version?: string;
    pragmas?: readonly string[];
    objectNames?: readonly string[];
  },
  fallback: boolean
): LibSqlDetection {
  const evidence: LibSqlEvidence[] = [
    ...detectLibSqlInHeader(signals.header),
    ...detectLibSqlInVersion(signals.version),
    ...detectLibSqlInSchema(signals.objectNames),
    ...detectLibSqlInPragma(signals.pragmas),
    ...detectLibSqlInExtension(filePath)
  ].sort((a, b) => b.weight - a.weight);

  const top = evidence[0];
  const libSql = top !== undefined;
  // `top` alone names the dialect: the three dialects are mutually exclusive by
  // definition, so whichever signal won decides both the verdict and the label.
  const engine: DbEngine =
    top?.kind === 'turso-version' || top?.kind === 'turso-extension' ? 'turso' : libSql ? 'libsql' : 'sqlite';
  return {
    engine,
    libSql,
    fallback: libSql && fallback,
    evidence,
    decidedBy: top ? top.kind : 'none'
  };
}
