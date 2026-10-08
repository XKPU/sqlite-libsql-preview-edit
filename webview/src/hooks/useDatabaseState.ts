// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ColumnInfo,
  DatabaseInfo,
  ErrorInfo,
  ExportFormat,
  ImportFieldMapping,
  ImportFormat,
  Language,
  ObjectInfo,
  QueryResult,
  RowEdit,
  SqlValue,
  WebviewSettings
} from '../../../src/shared/protocol';
import { quoteIdent, rowEditKey, SQLITE_CAPABILITIES } from '../../../src/shared/protocol';
import type { NewTableOptions } from '../../../src/shared/ddl';
import { buildNewTablePlan } from '../../../src/shared/ddl';
import type { MessageKey } from '../i18n';
import { useI18n } from '../i18n';
import type { HostMessageHandler } from './useWebview';
import { useWebview } from './useWebview';

/**
 * Localized phrase for each structured error code.
 *
 * Codes without an entry fall back to the driver message, which is the
 * informative case: `SQL_ERROR` and `UNKNOWN` carry real SQLite text the user
 * needs to see, so they are intentionally not replaced by a generic phrase.
 */
const ERROR_CODE_KEYS: Partial<Record<ErrorInfo['code'], MessageKey>> = {
  DB_CORRUPT: 'err.invalidFile',
  FILE_NOT_FOUND: 'err.fileMissing',
  FILE_EMPTY: 'err.emptyFile',
  PERMISSION: 'err.cantWrite',
  READONLY: 'err.cantWrite',
  TRANSACTION: 'err.txFailed',
  CANCELED: 'err.confirmCancelled',
  // Shown after installing a new build while a window still runs the old
  // extension host; the driver message carries the version detail.
  VERSION_MISMATCH: 'err.versionMismatch'
};

/**
 * Message key for a structured error code, or `null` when the driver's own
 * message should be shown (it carries detail no generic phrase can).
 *
 * Exported so components that render an error outside a toast — such as the
 * info bar after a failed open — use the same wording as the toasts.
 */
export function errorKey(error: ErrorInfo): MessageKey | null {
  return ERROR_CODE_KEYS[error.code] ?? null;
}

/* ------------------------------------------------------------------------ */
/* Shapes                                                                   */
/* ------------------------------------------------------------------------ */

export interface PageState {
  page: number;
  pageSize: number;
}

export interface RowEditState extends RowEdit {
  /** Present when the row is new (never committed). */
  isNew?: boolean;
  /** Present when the row is marked for deletion. */
  isDeleted?: boolean;
}

export interface ImportPreviewState {
  filePath: string;
  format: ImportFormat;
  headers: string[];
  mappings: ImportFieldMapping[];
  previewRows: SqlValue[][];
  conflict: 'skip' | 'replace' | 'fail';
  createTable: boolean;
}

export type ToastKind = 'info' | 'success' | 'error' | 'warning';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export type CenterTab = 'data' | 'properties' | 'sql';

export interface ActiveSelection {
  kind: 'table' | 'view' | 'index' | 'trigger' | 'sequence' | 'dataType';
  name: string;
  seq?: number;
}

/* ------------------------------------------------------------------------ */
/* Hook                                                                     */
/* ------------------------------------------------------------------------ */

export interface DatabaseState {
  dbInfo: DatabaseInfo | null;
  objects: ObjectInfo[];
  columns: ColumnInfo[];
  createSql: string;
  currentTable: string | null;
  currentObject: ActiveSelection | null;
  queryResults: QueryResult | null;
  /** Last SQL failure reported by the host, shown in the SQL result panel. */
  sqlError: ErrorInfo | null;
  sqlText: string;
  pendingEdits: RowEditState[];

  page: PageState;
  filters: Record<string, string>;
  search: string;
  sort: { column: string | null; dir: 'asc' | 'desc' };
  readOnly: boolean;
  centerTab: CenterTab;
  loading: boolean;
  progress: { phase: string; progress: number; detail?: string } | null;
  toast: Toast | null;
  language: Language;
  settings: WebviewSettings;
  sqlExecuting: boolean;
  importPreviewState: ImportPreviewState | null;
  activeImportTable: string | null;
  showExportDialog: boolean;
  showNewTableDialog: boolean;
  exportScope: 'table' | 'database' | 'sql';
  /**
   * Set when the file failed to open (corrupt, missing, unreadable).
   *
   * Without this the info bar had no way to leave its "Loading database…"
   * placeholder, so a failed open looked like an endless load.
   */
  loadError: ErrorInfo | null;

  openNewTableDialog: () => void;
  closeNewTableDialog: () => void;
  createTable: (options: NewTableOptions) => Promise<void>;
  selectTable: (name: string) => void;
  selectObject: (obj: ObjectInfo) => void;
  openStructure: (name: string) => void;
  openSettings: () => Promise<void>;
  switchTab: (tab: CenterTab) => void;
  refresh: () => Promise<void>;
  reopen: () => Promise<void>;
  close: () => Promise<void>;
  nextPage: () => void;
  prevPage: () => void;
  setSort: (column: string | null, dir: 'asc' | 'desc') => void;
  setRowFilter: (text: string) => void;
  setColumnFilter: (column: string, text: string) => void;
  clearColumnFilter: (column: string) => void;
  setCellEdit: (rowIndex: number, column: string, newValue: SqlValue) => void;
  addRow: () => void;
  deleteRow: (rowIndex: number) => void;
  restoreDeletedRow: (rowIndex: number) => void;
  duplicateRow: (rowIndex: number) => Promise<void>;
  save: () => Promise<void>;
  rollback: () => void;
  executeSql: (sql: string) => Promise<void>;
  executeDdl: (statements: string[]) => Promise<void>;
  deleteObject: (obj: ObjectInfo) => Promise<void>;
  setSqlText: (text: string) => void;
  runAllSql: () => void;
  runSelection: (sql: string) => void;
  clearSql: () => void;
  generateSelect: (obj: ObjectInfo) => void;
  startExport: (scope: 'table' | 'database' | 'sql') => void;
  /** Close the export dialog without exporting. */
  closeExport: () => void;
  doExport: (format: ExportFormat, selectSql?: string) => Promise<void>;
  startImport: (tableName: string) => void;
  importPreview: (filePath: string, format: ImportFormat) => Promise<void>;
  setImportMapping: (i: number, target: string, type: string) => void;
  setImportTableName: (name: string) => void;
  setImportCreateTable: (create: boolean) => void;
  setImportConflict: (mode: 'skip' | 'replace' | 'fail') => void;
  commitImport: () => Promise<void>;
  cancelImport: () => void;
  setLanguage: (lang: Language) => void;
  addToast: (kind: ToastKind, message: string) => void;
  clearToast: () => void;

  bridge: ReturnType<typeof useWebview>;
  rowCells: SqlValue[][] | null;
  rowKeys: { columns: string[]; values: SqlValue[] }[] | null;
}

const EMPTY_COLUMNS: ColumnInfo[] = [];

export function useDatabaseState(): DatabaseState {
  const bridge = useWebview();
  const { settings: bridgeSettings, language: bridgeLang } = bridge;
  const { t } = useI18n();

  /**
   * Turn a host error into a user-facing string.
   *
   * The adapter's `message` is deliberately English and technical (it carries
   * driver text), so it is only shown when no localized phrase exists for the
   * error code. This is what makes the toasts bilingual rather than leaking
   * English into the Chinese UI.
   */
  const describeError = useCallback(
    (error: ErrorInfo): string => {
      const key = errorKey(error);
      if (key) return t(key);
      return error.message;
    },
    [t]
  );

  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [objects, setObjects] = useState<ObjectInfo[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>(EMPTY_COLUMNS);
  const [createSql, setCreateSql] = useState('');
  const [currentTable, setCurrentTable] = useState<string | null>(null);
  const [currentObject, setCurrentObject] = useState<ActiveSelection | null>(null);
  const [queryResults, setQueryResults] = useState<QueryResult | null>(null);
  const [sqlError, setSqlError] = useState<ErrorInfo | null>(null);
  const [sqlText, setSqlTextState] = useState('');
  const [pendingEdits, setPendingEdits] = useState<RowEditState[]>([]);
  const [page, setPage] = useState<PageState>({ page: 0, pageSize: 50 });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [sort, setSortState] = useState<{ column: string | null; dir: 'asc' | 'desc' }>({
    column: null,
    dir: 'asc'
  });
  const [readOnly, setReadOnly] = useState(false);
  const [centerTab, setCenterTab] = useState<CenterTab>('data');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ phase: string; progress: number; detail?: string } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sqlExecuting, setSqlExecuting] = useState(false);
  const [importPreviewState, setImportPreviewState] = useState<ImportPreviewState | null>(null);
  const [activeImportTable, setActiveImportTable] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportScope, setExportScope] = useState<'table' | 'database' | 'sql'>('table');
  const [showNewTableDialog, setShowNewTableDialog] = useState(false);
  const [loadError, setLoadError] = useState<ErrorInfo | null>(null);

  const toastId = useRef(1);
  const toastTimer = useRef<number | null>(null);

  /**
   * Latest `refresh`, reachable from the host-message handler.
   *
   * The handler is registered once per bridge identity and must not re-subscribe
   * on every render (that churn is what previously dropped the `init` reply).
   * `refresh` itself is defined far below and changes identity whenever the
   * selected table changes, so the handler reads it through this ref instead of
   * capturing a stale closure or listing it as a dependency.
   */
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const addToast = useCallback((kind: ToastKind, message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    const id = toastId.current++;
    setToast({ id, kind, message });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 4500);
  }, []);

  const clearToast = useCallback(() => {
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
  }, []);

  /* ---- bridge global message handler ------------------------------------ */

  /**
   * Apply a `ready` snapshot.
   *
   * Called from two places: the unsolicited push the host makes when the editor
   * opens (id 0), and the reply to the webview's `init` handshake (id > 0,
   * which the bridge routes to the promise rather than the handlers). Applying
   * it twice is harmless because every field is a straight replacement.
   */
  const applyReady = useCallback((info: DatabaseInfo, objects: ObjectInfo[], readOnlyFlag: boolean) => {
    setDbInfo(info);
    setObjects(objects);
    setReadOnly(readOnlyFlag);
    // The database is loaded; any spinner from the initial mount must stop.
    setLoading(false);
    setLoadError(null);
  }, []);

  useEffect(() => {
    const handler: HostMessageHandler = (msg) => {
      switch (msg.type) {
        case 'progress':
          setProgress({ phase: msg.phase, progress: msg.progress, detail: msg.detail });
          break;
        case 'log':
          addToast(msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warning' : 'info', msg.message);
          break;
        case 'error':
          // The host posts an unsolicited error (id 0) when the initial open
          // fails, so record it to leave the loading placeholder.
          setLoadError(msg.error);
          setLoading(false);
          addToast('error', describeError(msg.error));
          break;
        case 'ready':
          applyReady(msg.info, msg.objects, msg.settings.readOnly);
          break;
        case 'languageChanged':
          setReadOnly(msg.settings.readOnly);
          break;
        case 'readOnly':
          setReadOnly(msg.readOnly);
          break;
        /**
         * The host asks for the new-table dialog — either because the user ran
         * the `newTableDialog` command from the toolbar/menu, or because the
         * editor was opened from an "Add object" entry point.
         *
         * This used to be dropped silently: the host posted `addObject` and the
         * handler had no matching case, so the button did nothing at all.
         */
        case 'addObject':
          setShowNewTableDialog(true);
          break;
        /**
         * Toolbar-driven refresh / "open SQL editor". The host has no DB state
         * of its own; it only signals intent, and the webview re-fetches. Both
         * were posted by the extension and previously fell through to `default`
         * with no effect.
         */
        case 'refreshRequested':
          void refreshRef.current();
          break;
        case 'showSql':
          setCenterTab('sql');
          break;
        default:
          break;
      }
    };
    const off = bridge.onHostMessage(handler);
    return off;
  }, [bridge, addToast, applyReady, describeError]);

  /**
   * Handshake with the host on mount.
   *
   * The host pushes `ready` while `resolveCustomEditor` runs, which can happen
   * before this component has attached its listener — the push is then dropped
   * and the editor would sit on "Loading database…" forever. Asking for the
   * state once mounted removes that race entirely.
   *
   * Deliberately NOT guarded by a "run once" ref. That guard caused the actual
   * stall: `useWebview` used to return a fresh object literal every render, so
   * this effect's `[bridge]` dependency changed on each render. React then ran
   * this effect's cleanup before its reply arrived, setting `cancelled = true`,
   * and the guard then blocked the retry — the reply was discarded forever and
   * `dbInfo` stayed null. (`bridge` now has a stable identity; see useWebview.)
   *
   * Re-asking is cheap and idempotent — the host replies with the same snapshot
   * — so there is no guard, and a cancelled attempt is always recoverable.
   */
  useEffect(() => {
    let cancelled = false;
    bridge.log('info', 'webview mounted: sending init handshake');
    void (async () => {
      const res = await bridge.send({ type: 'init' });
      bridge.log('info', `init reply: ok=${res.ok} type=${res.ok ? res.response.type : 'error'}`);
      if (cancelled) {
        bridge.log('warn', 'init reply arrived after unmount — discarding');
        return;
      }
      if (!res.ok) {
        setLoadError(res.error);
        setLoading(false);
        addToast('error', describeError(res.error));
        return;
      }
      if (res.response.type === 'ready') {
        applyReady(res.response.info, res.response.objects, res.response.settings.readOnly);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, addToast, describeError, applyReady]);

  useEffect(() => {
    if (bridgeSettings) setReadOnly(bridgeSettings.readOnly);
  }, [bridgeSettings]);

  /* ---- low-level helpers ------------------------------------------------ */
  const showProgress = useCallback((phase: string) => setProgress({ phase, progress: 0.05 }), []);
  const hideProgress = useCallback(() => setProgress(null), []);

  const refreshMetadata = useCallback(async () => {
    const res = await bridge.send({ type: 'getMetadata' });
    if (!res.ok) {
      addToast('error', describeError(res.error));
      return;
    }
    const meta = res.response as { objects: ObjectInfo[] };
    setObjects(meta.objects);
  }, [bridge, addToast, describeError]);

  const refreshInfo = useCallback(async () => {
    const res = await bridge.send({ type: 'getInfo' });
    if (!res.ok) {
      addToast('error', describeError(res.error));
      return;
    }
    setDbInfo((res.response as { info: DatabaseInfo }).info);
  }, [bridge, addToast, describeError]);

  const refreshSchema = useCallback(
    async (name: string) => {
      const res = await bridge.send({ type: 'getSchema', objectName: name });
      if (!res.ok) {
        addToast('error', describeError(res.error));
        return;
      }
      const r = res.response as { columns: ColumnInfo[]; sql: string };
      setColumns(r.columns);
      setCreateSql(r.sql || '');
    },
    [bridge, addToast, describeError]
  );

  /* ---- page query ------------------------------------------------------- */
  const runPageQuery = useCallback(async () => {
    if (!currentTable) {
      setQueryResults(null);
      // Nothing is being fetched, so the spinner must not stay lit. `loading`
      // starts true and is only cleared by a query, so without this the status
      // bar spins forever on a freshly opened database with no table selected.
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      let sql = buildTableSql(currentTable, columns);
      const where = buildWhere(filters, search, columns);
      const params: SqlValue[] = [];
      if (where) {
        sql += ` WHERE ${where.clause}`;
        params.push(...where.params);
      }
      if (sort.column) {
        sql += ` ORDER BY ${quoteIdent(sort.column)} ${sort.dir === 'asc' ? 'ASC' : 'DESC'}`;
      }
      const res = await bridge.send({
        type: 'query',
        sql,
        page: page.page,
        pageSize: page.pageSize,
        params
      });
      if (!res.ok) {
        addToast('error', describeError(res.error));
        return;
      }
      setQueryResults((res.response as { result: QueryResult }).result);
    } finally {
      setLoading(false);
    }
  }, [bridge, currentTable, columns, filters, search, sort, page, describeError, addToast]);

  useEffect(() => {
    void runPageQuery();
  }, [runPageQuery]);

  /* ---- selection -------------------------------------------------------- */
  const selectTable = useCallback(
    (name: string) => {
      setCurrentTable(name);
      setCurrentObject({ kind: 'table', name });
      setCenterTab('data');
      setPendingEdits([]);
      setQueryResults(null);
      setSqlError(null);
      setFilters({});
      setSearch('');
      setSortState({ column: null, dir: 'asc' });
      setPage({ page: 0, pageSize: bridgeSettings.pageSize });
      void refreshSchema(name);
    },
    [bridgeSettings.pageSize, refreshSchema]
  );

  const openStructure = useCallback(
    (name: string) => {
      setCurrentTable(name);
      setCurrentObject({ kind: 'table', name });
      setCenterTab('properties');
      void refreshSchema(name);
    },
    [refreshSchema]
  );

  const openSettings = useCallback(async () => {
    try {
      await bridge.send({ type: 'openSettings' });
    } catch {
      // no-op: settings is best-effort and should not block the UI
    }
  }, [bridge]);

  const selectObject = useCallback(
    (obj: ObjectInfo) => {
      if (obj.type === 'table') {
        selectTable(obj.name);
      } else if (obj.type === 'view') {
        setCurrentObject({ kind: 'view', name: obj.name });
        setSqlTextState(obj.sql || `-- VIEW ${obj.name}`);
        setCenterTab('sql');
      } else if (obj.type === 'index' || obj.type === 'trigger') {
        setCurrentObject({ kind: obj.type, name: obj.name });
        setSqlTextState(obj.sql || `-- ${obj.type.toUpperCase()} ${obj.name}`);
        setCenterTab('sql');
      } else if (obj.type === 'sequence') {
        setCurrentObject({ kind: 'sequence', name: obj.name, seq: obj.seq });
        setCurrentTable(null);
        setCenterTab('properties');
      } else if (obj.type === 'dataType') {
        setCurrentObject({ kind: 'dataType', name: obj.name });
        setCenterTab('properties');
      } else {
        setCurrentObject({ kind: obj.type as ActiveSelection['kind'], name: obj.name });
        setSqlTextState(obj.sql || `-- ${obj.type.toUpperCase()} ${obj.name}`);
        setCenterTab('sql');
      }
    },
    [selectTable]
  );

  /* ---- refresh / reopen / close ---------------------------------------- */
  const refresh = useCallback(async () => {
    showProgress('Refreshing…');
    await Promise.all([refreshInfo(), refreshMetadata()]);
    if (currentTable) await refreshSchema(currentTable);
    hideProgress();
  }, [refreshInfo, refreshMetadata, refreshSchema, currentTable, showProgress, hideProgress]);

  // Keep the host-message handler's view of `refresh` current without making the
  // handler re-subscribe (see refreshRef's declaration).
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const reopen = useCallback(async () => {
    if (!dbInfo) return;
    showProgress('Opening database…');
    const res = await bridge.send({ type: 'open', path: dbInfo.path });
    if (!res.ok) {
      addToast('error', describeError(res.error));
      hideProgress();
      return;
    }
    await refresh();
  }, [bridge, dbInfo, refresh, addToast, showProgress, hideProgress, describeError]);

  const close = useCallback(async () => {
    if (pendingEdits.length > 0) {
      addToast('warning', t('msg.cannotClose'));
      return;
    }
    const res = await bridge.send({ type: 'close' });
    if (!res.ok) addToast('error', describeError(res.error));
    setDbInfo(null);
    setObjects([]);
    setCurrentTable(null);
    setCurrentObject(null);
    setPendingEdits([]);
    setQueryResults(null);
    setSqlError(null);
  }, [bridge, pendingEdits.length, addToast, describeError, t]);

  /* ---- pagination ------------------------------------------------------- */
  const nextPage = useCallback(() => setPage((p) => ({ ...p, page: p.page + 1 })), []);
  const prevPage = useCallback(() => setPage((p) => ({ ...p, page: Math.max(0, p.page - 1) })), []);

  const setSort = useCallback((column: string | null, dir: 'asc' | 'desc') => {
    setSortState((s) => (s.column === column ? { column, dir: dir === 'asc' ? 'desc' : 'asc' } : { column, dir }));
    setPage((p) => ({ ...p, page: 0 }));
  }, []);

  const setRowFilter = useCallback((text: string) => {
    setSearch(text);
    setPage((p) => ({ ...p, page: 0 }));
  }, []);

  const setColumnFilter = useCallback((column: string, text: string) => {
    setFilters((f) => ({ ...f, [column]: text }));
    setPage((p) => ({ ...p, page: 0 }));
  }, []);

  const clearColumnFilter = useCallback((column: string) => {
    setFilters((f) => {
      const next = { ...f };
      delete next[column];
      return next;
    });
    setPage((p) => ({ ...p, page: 0 }));
  }, []);

  /* ---- row editing ------------------------------------------------------ */
  const rowCells = queryResults && queryResults.isQuery ? queryResults.rows : null;
  const rowKeys = useMemo(() => {
    if (!currentTable || !queryResults || !queryResults.isQuery || columns.length === 0) return null;
    const pkCols = columns.filter((c) => c.pk && !c.hidden).map((c) => c.name);
    const keyCols = pkCols.length > 0 ? pkCols : ['rowid'];
    return queryResults.rows.map((cells) => ({
      columns: keyCols,
      values: keyCols.map((col) => {
        const idx = columns.findIndex((c) => c.name === col);
        const cell = idx >= 0 ? cells[idx] : undefined;
        return cell ?? null;
      })
    }));
  }, [currentTable, queryResults, columns]);

  const rowEditsForSend = useCallback((): RowEdit[] => {
    return pendingEdits.map((e) => ({ key: e.key, edits: e.edits }));
  }, [pendingEdits]);

  const setCellEdit = useCallback(
    (rowIndex: number, column: string, newValue: SqlValue) => {
      if (readOnly) return;
      if (!currentTable || !rowKeys || !rowCells) return;
      const cells = rowCells[rowIndex];
      if (!cells) return;
      const colIdx = columns.findIndex((c) => c.name === column);
      if (colIdx < 0) return;
      const original = cells[colIdx] ?? null;
      const key = rowKeys[rowIndex];
      if (!key) return;
      setPendingEdits((prev) => {
        const idx = prev.findIndex(
          (e) =>
            rowEditKey(e.key.table, e.key.keyColumns, e.key.keyValues) ===
            rowEditKey(currentTable, key.columns, key.values)
        );
        if (idx >= 0) {
          const existing = prev[idx];
          if (!existing) return prev;
          const editIdx = existing.edits.findIndex((ed) => ed.column === column);
          if (editIdx >= 0) {
            const existingEdit = existing.edits[editIdx];
            if (!existingEdit) return prev;
            if (existingEdit.value === newValue) return prev;
            const nextEdits = existing.edits.slice();
            nextEdits[editIdx] = { column, value: newValue, original };
            const out = prev.slice();
            out[idx] = { ...existing, edits: nextEdits };
            return out;
          }
          const out = prev.slice();
          out[idx] = { ...existing, edits: [...existing.edits, { column, value: newValue, original }] };
          return out;
        }
        return [
          ...prev,
          {
            key: { table: currentTable, keyColumns: key.columns, keyValues: key.values },
            edits: [{ column, value: newValue, original }]
          }
        ];
      });
    },
    [currentTable, readOnly, rowCells, rowKeys, columns]
  );

  const addRow = useCallback(() => {
    if (readOnly || !currentTable) return;
    const key = { table: currentTable, keyColumns: ['__new__'], keyValues: [Date.now()] };
    setPendingEdits((prev) => [...prev, { key, edits: [], isNew: true }]);
  }, [currentTable, readOnly]);

  const deleteRow = useCallback(
    (rowIndex: number) => {
      if (readOnly || !currentTable || !rowKeys) return;
      const key = rowKeys[rowIndex];
      if (!key) return;
      setPendingEdits((prev) => {
        const idx = prev.findIndex(
          (e) =>
            rowEditKey(e.key.table, e.key.keyColumns, e.key.keyValues) ===
            rowEditKey(currentTable, key.columns, key.values)
        );
        if (idx >= 0) {
          const existing = prev[idx];
          if (!existing) return prev;
          const out = prev.slice();
          out[idx] = { ...existing, isDeleted: true };
          return out;
        }
        return [
          ...prev,
          {
            key: { table: currentTable, keyColumns: key.columns, keyValues: key.values },
            edits: [],
            isDeleted: true
          }
        ];
      });
    },
    [currentTable, readOnly, rowKeys]
  );

  const restoreDeletedRow = useCallback(
    (rowIndex: number) => {
      if (!currentTable || !rowKeys) return;
      const key = rowKeys[rowIndex];
      if (!key) return;
      setPendingEdits((prev) =>
        prev.filter(
          (e) =>
            rowEditKey(e.key.table, e.key.keyColumns, e.key.keyValues) !==
            rowEditKey(currentTable, key.columns, key.values)
        )
      );
    },
    [currentTable, rowKeys]
  );

  const duplicateRow = useCallback(
    async (rowIndex: number) => {
      if (!currentTable || !rowKeys) return;
      const key = rowKeys[rowIndex];
      const res = await bridge.send({ type: 'duplicateRow', key });
      if (!res.ok) {
        addToast('error', describeError(res.error));
        return;
      }
      await runPageQuery();
    },
    [bridge, addToast, currentTable, rowKeys, runPageQuery, describeError]
  );

  /* ---- save / rollback -------------------------------------------------- */
  const save = useCallback(async () => {
    if (readOnly) {
      addToast('warning', t('warn.readOnly'));
      return;
    }
    if (pendingEdits.length === 0) return;
    try {
      showProgress('Saving…');
      const insertEdits = pendingEdits.filter((e) => e.isNew);
      const deleteKeys = pendingEdits.filter((e) => e.isDeleted).map((e) => e.key);
      const updateEdits = pendingEdits.filter((e) => !e.isNew && !e.isDeleted);

      for (const ins of insertEdits) {
        const values: Record<string, SqlValue> = {};
        for (const ed of ins.edits) values[ed.column] = ed.value;
        const r = await bridge.send({ type: 'insertRow', table: ins.key.table, values });
        if (!r.ok) {
          addToast('error', describeError(r.error));
          return;
        }
      }
      if (deleteKeys.length > 0) {
        const r = await bridge.send({ type: 'deleteRows', keys: deleteKeys });
        if (!r.ok) {
          addToast('error', describeError(r.error));
          return;
        }
      }
      if (updateEdits.length > 0) {
        const r = await bridge.send({ type: 'commitEdits', edits: rowEditsForSend() });
        if (!r.ok) {
          addToast('error', describeError(r.error));
          return;
        }
      }
      setPendingEdits([]);
      await runPageQuery();
      await refreshInfo();
    } finally {
      hideProgress();
    }
  }, [
    bridge,
    pendingEdits,
    readOnly,
    runPageQuery,
    refreshInfo,
    addToast,
    rowEditsForSend,
    showProgress,
    hideProgress,
    describeError,
    t
  ]);

  const rollback = useCallback(() => setPendingEdits([]), []);

  /* ---- SQL execution ---------------------------------------------------- */
  const executeSql = useCallback(
    async (sql: string) => {
      if (!sql.trim()) {
        addToast('warning', t('warn.noSql'));
        return;
      }
      try {
        setSqlExecuting(true);
        setSqlError(null);
        const res = await bridge.send({ type: 'executeSql', sql });
        if (!res.ok) {
          const err = res.error;
          const synthetic: QueryResult = {
            columns: [],
            rows: [],
            totalRows: 0,
            truncated: false,
            isQuery: false,
            durationMs: 0
          };
          setQueryResults(synthetic);
          setSqlError({
            code: err.code,
            message: err.message,
            raw: err.raw,
            line: err.line,
            column: err.column,
            sql: err.sql || sql
          });
          setCenterTab('sql');
          return;
        }
        setSqlError(null);
        setQueryResults((res.response as { result: QueryResult }).result);
        setCenterTab('sql');
        if (currentTable) await refreshSchema(currentTable);
      } finally {
        setSqlExecuting(false);
      }
    },
    [bridge, addToast, currentTable, refreshSchema, t]
  );

  const executeDdl = useCallback(
    async (statements: string[]) => {
      if (statements.length === 0) return;
      const res = await bridge.send({ type: 'executeDdl', statements });
      if (!res.ok) {
        addToast('error', describeError(res.error));
        return;
      }
      addToast('success', `Applied ${statements.length} DDL statement(s).`);
      await Promise.all([refreshInfo(), refreshMetadata()]);
      if (currentTable) await refreshSchema(currentTable);
    },
    [bridge, addToast, refreshInfo, refreshMetadata, refreshSchema, currentTable, describeError]
  );

  const deleteObject = useCallback(
    async (obj: ObjectInfo) => {
      const res = await bridge.send({ type: 'deleteObject', name: obj.name, objectType: obj.type });
      if (!res.ok) {
        addToast('error', describeError(res.error));
        return;
      }
      addToast('success', `${obj.type} "${obj.name}" deleted.`);
      if (currentTable === obj.name) {
        setCurrentTable(null);
        setCurrentObject(null);
        setQueryResults(null);
        setColumns(EMPTY_COLUMNS);
        setCreateSql('');
        setPendingEdits([]);
      }
      await Promise.all([refreshInfo(), refreshMetadata()]);
    },
    [bridge, addToast, currentTable, refreshInfo, refreshMetadata, describeError]
  );

  /* ---- new table ------------------------------------------------------- */

  const openNewTableDialog = useCallback(() => setShowNewTableDialog(true), []);
  const closeNewTableDialog = useCallback(() => setShowNewTableDialog(false), []);

  /**
   * Create a table from the new-table dialog.
   *
   * The SQL is assembled by `buildNewTablePlan` in `src/shared/ddl.ts`, which is
   * also what decides whether a sequence is legal for the current engine. The
   * dialog is authoritative for input, but this layer re-runs the plan so a
   * caller cannot post LibreSQL-only DDL to a plain SQLite file by accident.
   *
   * Returns the created table name so the caller can select it; throws with a
   * readable message when the plan refuses the input, which the dialog renders
   * inline rather than as a toast (the user is still editing the form).
   */
  const createTable = useCallback(
    async (options: NewTableOptions) => {
      const engine = dbInfo?.engine ?? 'sqlite';
      const capabilities = dbInfo?.capabilities ?? SQLITE_CAPABILITIES;
      const plan = buildNewTablePlan(options, {
        engine,
        capabilities,
        // Sequences are a Turso Database extension; the capability flag is the
        // source of truth, so a plain SQLite or libSQL file cannot emit DDL its
        // engine would reject.
        sequencesSupported: capabilities.sequences === true,
        existingNames: objects.map((o) => o.name)
      });
      if (!plan.ok) {
        throw new Error(t(plan.errorKey));
      }
      const res = await bridge.send({ type: 'executeDdl', statements: plan.statements });
      if (!res.ok) {
        addToast('error', describeError(res.error));
        return;
      }
      for (const key of plan.warningKeys) addToast('warning', t(key));
      addToast('success', t('newTable.created'));
      setShowNewTableDialog(false);
      await Promise.all([refreshInfo(), refreshMetadata()]);
    },
    [bridge, dbInfo, objects, addToast, describeError, refreshInfo, refreshMetadata, t]
  );

  const setSqlText = useCallback((text: string) => setSqlTextState(text), []);
  const clearSql = useCallback(() => setSqlTextState(''), []);
  const runAllSql = useCallback(() => void executeSql(sqlText), [executeSql, sqlText]);
  const runSelection = useCallback((text: string) => void executeSql(text), [executeSql]);

  const generateSelect = useCallback(
    (obj: ObjectInfo) => {
      if (obj.type !== 'table' && obj.type !== 'view') {
        addToast('warning', t('warn.selectOnly'));
        return;
      }
      setSqlTextState(`SELECT * FROM ${quoteIdent(obj.name)};\n`);
      setCenterTab('sql');
    },
    [addToast, t]
  );

  /* ---- export / import -------------------------------------------------- */
  const startExport = useCallback((scope: 'table' | 'database' | 'sql') => {
    setExportScope(scope);
    setShowExportDialog(true);
  }, []);

  const closeExport = useCallback(() => setShowExportDialog(false), []);

  const doExport = useCallback(
    async (format: ExportFormat, selectSql?: string) => {
      try {
        showProgress('Exporting…');
        let res;
        if (exportScope === 'database') {
          res = await bridge.send({ type: 'exportDatabase', format });
        } else if (exportScope === 'sql' && selectSql) {
          res = await bridge.send({ type: 'export', format, selectSql });
        } else if (currentTable) {
          res = await bridge.send({ type: 'export', format, objectName: currentTable });
        } else {
          addToast('warning', t('warn.nothingToExport'));
          return;
        }
        if (!res.ok) {
          addToast('error', describeError(res.error));
          return;
        }
        // A dismissed save dialog is not a success and not a failure: report
        // nothing and leave the dialog open so the user can try again.
        if ((res.response as { type?: string }).type === 'exportCancelled') return;
        const r = res.response as { filePath: string; sizeBytes: number };
        addToast('success', t('export.done', { path: r.filePath }));
        setShowExportDialog(false);
      } finally {
        hideProgress();
      }
    },
    [bridge, exportScope, currentTable, addToast, showProgress, hideProgress, describeError, t]
  );

  const startImport = useCallback((tableName: string) => {
    setActiveImportTable(tableName);
    setImportPreviewState(null);
  }, []);

  const importPreview = useCallback(
    async (filePath: string, format: ImportFormat) => {
      try {
        showProgress('Reading import file…');
        const res = await bridge.send({ type: 'importPreview', filePath, format });
        if (!res.ok) {
          addToast('error', describeError(res.error));
          return;
        }
        const r = res.response as {
          headers: string[];
          mappings: ImportFieldMapping[];
          previewRows: SqlValue[][];
        };
        setImportPreviewState({
          filePath,
          format,
          headers: r.headers,
          mappings: r.mappings,
          previewRows: r.previewRows,
          conflict: 'skip',
          createTable: true
        });
      } finally {
        hideProgress();
      }
    },
    [bridge, addToast, showProgress, hideProgress, describeError]
  );

  const setImportMapping = useCallback((i: number, target: string, type: string) => {
    setImportPreviewState((p) => {
      if (!p) return p;
      const mappings = p.mappings.slice();
      if (mappings[i]) mappings[i] = { ...mappings[i], target, inferredType: type };
      return { ...p, mappings };
    });
  }, []);

  const setImportTableName = useCallback((name: string) => setActiveImportTable(name), []);

  const setImportCreateTable = useCallback((create: boolean) => {
    setImportPreviewState((p) => (p ? { ...p, createTable: create } : p));
  }, []);

  const setImportConflict = useCallback((mode: 'skip' | 'replace' | 'fail') => {
    setImportPreviewState((p) => (p ? { ...p, conflict: mode } : p));
  }, []);

  const commitImport = useCallback(async () => {
    if (!importPreviewState || !activeImportTable) return;
    const res = await bridge.send({
      type: 'importCommit',
      options: {
        format: importPreviewState.format,
        tableName: activeImportTable,
        mappings: importPreviewState.mappings,
        conflict: importPreviewState.conflict,
        createTable: importPreviewState.createTable
      },
      filePath: importPreviewState.filePath
    });
    if (!res.ok) {
      addToast('error', describeError(res.error));
      return;
    }
    const r = res.response as { rows: number; skipped: number };
    addToast('success', `Imported ${r.rows} rows, skipped ${r.skipped}`);
    setImportPreviewState(null);
    setActiveImportTable(null);
    if (currentTable) await runPageQuery();
    await Promise.all([refreshInfo(), refreshMetadata()]);
  }, [
    bridge,
    importPreviewState,
    activeImportTable,
    addToast,
    currentTable,
    runPageQuery,
    refreshInfo,
    refreshMetadata,
    describeError
  ]);

  const cancelImport = useCallback(() => {
    setImportPreviewState(null);
    setActiveImportTable(null);
  }, []);

  /* ---- language --------------------------------------------------------- */
  const setLanguage = useCallback(
    (lang: Language) => {
      // The host owns the setting; it persists the choice and broadcasts
      // `languageChanged`, which updates the i18n provider for every editor.
      void bridge
        .send({ type: 'setLanguage', language: lang })
        .then((res) => {
          if (!res.ok) addToast('error', describeError(res.error));
        })
        .catch(() => undefined);
    },
    [bridge, addToast, describeError]
  );

  return {
    dbInfo,
    objects,
    columns,
    createSql,
    currentTable,
    currentObject,
    queryResults,
    sqlError,
    sqlText,
    pendingEdits,
    page,
    filters,
    search,
    sort,
    readOnly,
    centerTab,
    loading,
    progress,
    toast,
    language: bridgeLang,
    settings: bridgeSettings,
    sqlExecuting,
    importPreviewState,
    activeImportTable,
    showExportDialog,
    showNewTableDialog,
    openNewTableDialog,
    closeNewTableDialog,
    createTable,
    exportScope,
    loadError,
    selectTable,
    selectObject,
    openStructure,
    openSettings,
    switchTab: setCenterTab,
    refresh,
    reopen,
    close,
    nextPage,
    prevPage,
    setSort,
    setRowFilter,
    setColumnFilter,
    clearColumnFilter,
    setCellEdit,
    addRow,
    deleteRow,
    restoreDeletedRow,
    duplicateRow,
    save,
    rollback,
    executeSql,
    executeDdl,
    deleteObject,
    setSqlText,
    runAllSql,
    runSelection,
    clearSql,
    generateSelect,
    startExport,
    closeExport,
    doExport,
    startImport,
    importPreview,
    setImportMapping,
    setImportTableName,
    setImportCreateTable,
    setImportConflict,
    commitImport,
    cancelImport,
    setLanguage,
    addToast,
    clearToast,
    bridge,
    rowCells,
    rowKeys
  };
}

/* ------------------------------------------------------------------------ */
/* SQL builders                                                             */
/* ------------------------------------------------------------------------ */

function buildTableSql(table: string, columns: ColumnInfo[]): string {
  const cols = columns.filter((c) => !c.hidden).map((c) => quoteIdent(c.name));
  if (cols.length === 0) return `SELECT * FROM ${quoteIdent(table)}`;
  return `SELECT ${cols.join(', ')} FROM ${quoteIdent(table)}`;
}

function buildWhere(
  filters: Record<string, string>,
  search: string,
  columns: ColumnInfo[]
): { clause: string; params: SqlValue[] } | undefined {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (columns.length === 0) return undefined;
  for (const [col, val] of Object.entries(filters)) {
    if (!val) continue;
    // Values are bound as parameters, never interpolated. Interpolation was an
    // injection hole: `escapeLike` escapes LIKE wildcards but a single quote in
    // the value used to break out of the `'%…%'` literal. LIKE wildcard
    // escaping stays client-side because it is matching semantics, not safety.
    clauses.push(`${quoteIdent(col)} LIKE '%' || ? || '%' ESCAPE '\\'`);
    params.push(escapeLike(val));
  }
  if (search) {
    const escaped = escapeLike(search);
    for (const c of columns) {
      if (c.hidden) continue;
      clauses.push(`${quoteIdent(c.name)} LIKE '%' || ? || '%' ESCAPE '\\'`);
      params.push(escaped);
    }
  }
  return clauses.length === 0 ? undefined : { clause: clauses.join(' OR '), params };
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
