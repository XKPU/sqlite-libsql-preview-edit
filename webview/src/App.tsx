// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useState } from 'react';
import type { DbEngine, Language } from '../../src/shared/protocol';
import { useI18n } from './i18n';
import { useDatabaseState, errorKey } from './hooks/useDatabaseState';
import { ObjectTree } from './components/ObjectTree';
import { DataTable } from './components/DataTable';
import { SqlEditor } from './components/SqlEditor';
import { SqlResult } from './components/SqlResult';
import { StructureView } from './components/StructureView';
import { SequenceView } from './components/SequenceView';
import { DataTypeView } from './components/DataTypeView';
import { ExportDialog, ImportDialog, NewTableDialog } from './components/dialogs';
import { Button, Icon, Modal, Spinner, ToolbarIconButton } from './components/common';

export const App: React.FC = () => {
  const state = useDatabaseState();
  const { t, setLanguage } = useI18n();
  const [treeWidth, setTreeWidth] = useState(240);
  const [dragging, setDragging] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Apply the host's persisted language to the UI. The host owns the setting,
  // so without this an editor would always render in English on first paint,
  // even when the user had previously chosen Chinese.
  useEffect(() => {
    setLanguage(state.language);
  }, [state.language, setLanguage]);

  const handleRefresh = useCallback(() => {
    void state.refresh();
  }, [state]);

  const handleInfo = useCallback(() => {
    setShowInfo((s) => !s);
  }, []);

  // Horizontal resize of the object tree
  const startTreeDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w = Math.max(160, Math.min(420, e.clientX - rect.left));
      setTreeWidth(w);
    };
    const onUp = () => {
      setDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const centerTab = state.centerTab;

  return (
    <div className="app" ref={containerRef}>
      {state.progress && (
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${Math.min(100, Math.max(2, state.progress.progress * 100))}%` }}
          />
        </div>
      )}

      <div className="app-main">
        <div className="object-tree" style={{ width: treeWidth }}>
          <ObjectTree state={state} />
        </div>
        <div className="resize-handle" onMouseDown={startTreeDrag} />

        <div className="center">
          {state.dbInfo ? (
            <>
              <div className="tabs">
                {state.currentObject ? (
                  <>
                {state.currentObject && state.currentObject.kind !== 'sequence' && (
                  <button
                    className={'tab' + (centerTab === 'data' ? ' tab-active' : '')}
                    onClick={() => state.switchTab('data')}
                    disabled={state.currentObject.kind !== 'table'}
                  >
                    <Icon name="rows" size={12} />
                    {t('menu.viewData')}
                  </button>
                )}
                <button
                  className={'tab' + (centerTab === 'properties' ? ' tab-active' : '')}
                  onClick={() => state.switchTab('properties')}
                  disabled={state.currentObject?.kind !== 'table' && state.currentObject?.kind !== 'sequence'}
                >
                  <Icon name="columns" size={12} />
                  {t('menu.properties')}
                </button>
                {state.currentObject && state.currentObject.kind !== 'sequence' && (
                  <button className={'tab' + (centerTab === 'sql' ? ' tab-active' : '')} onClick={() => state.switchTab('sql')}>
                    <Icon name="sql" size={12} />
                    {t('sql.editorTitle')}
                  </button>
                )}
                  </>
                ) : null}
                <div className="tabs-actions">
                  <ToolbarIconButton icon="export" onClick={() => state.startExport('table')} label={t('menu.exportTable')} />
                  <ToolbarIconButton icon="refresh" loading={state.loading} onClick={handleRefresh} label={t('cmd.refresh')} />
                  <ToolbarIconButton icon="info" onClick={handleInfo} label={t('cmd.info')} className={showInfo ? 'toolbar-active' : undefined} />
                  <div className="divider-v" />
                  <ToolbarIconButton icon="settings" onClick={() => void state.openSettings()} label={t('cmd.openSettings')} />
                </div>
              </div>

              <div className="tab-content">
                {centerTab === 'data' && state.currentObject?.kind !== 'sequence' && (
                  state.currentObject?.kind === 'dataType' ? <DataTypeView state={state} /> :
                  <DataTable state={state} />
                )}
                {centerTab === 'properties' && (state.currentObject?.kind === 'sequence' ? <SequenceView state={state} /> : <StructureView state={state} />)}
                {centerTab === 'sql' && state.currentObject?.kind !== 'sequence' && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <SqlEditor state={state} />
                    <SqlResult state={state} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className={'center-placeholder' + (state.loadError ? ' error' : '')}>
              {state.loadError ? (
                <>
                  <Icon name="warning" size={32} />
                  <span>{errorKey(state.loadError) ? t(errorKey(state.loadError)!) : state.loadError.message}</span>
                  {errorKey(state.loadError) && (
                    <span className="placeholder-detail">{state.loadError.message}</span>
                  )}
                </>
              ) : (
                <>
                  <Spinner size="lg" />
                  <span>{t('msg.loading')}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <StatusBar state={state} />

      {/* Toast */}
      {state.toast && (
        <div className="toast-container">
          <div className={`toast toast-${state.toast.kind}`}>
            <Icon
              name={
                state.toast.kind === 'error'
                  ? 'warning'
                  : state.toast.kind === 'success'
                  ? 'check'
                  : state.toast.kind === 'warning'
                  ? 'info'
                  : 'info'
              }
              size={14}
            />
            <span style={{ flex: 1, wordBreak: 'break-word' }}>{state.toast.message}</span>
            <Button variant="icon" icon="close" size="sm" onClick={() => state.clearToast()} aria-label={t('close')} />
          </div>
        </div>
      )}

      {showInfo && state.dbInfo && <InfoDetail dbInfo={state.dbInfo} onClose={() => setShowInfo(false)} />}
      <ExportDialog state={state} open={state.showExportDialog} onClose={() => state.closeExport()} />
      <ImportDialog
        state={state}
        open={!!state.activeImportTable}
        onClose={() => state.cancelImport()}
      />
      <NewTableDialog
        state={state}
        open={state.showNewTableDialog}
        onClose={() => state.closeNewTableDialog()}
      />
    </div>
  );
};

/* ------------------------------------------------------------------------ */
/* Status Bar                                                               */
/* ------------------------------------------------------------------------ */

const StatusBar: React.FC<{ state: ReturnType<typeof useDatabaseState> }> = ({ state }) => {
  const { t } = useI18n();
  const { dbInfo, currentTable, queryResults, pendingEdits, readOnly, loading, sqlExecuting, progress } = state;
  return (
    <div className="status-bar">
      <div className="status-bar-section">
        {dbInfo ? (
          <>
            <Icon name={readOnly ? 'database-locked' : 'database'} size={12} />
            <span>{readOnly ? t('status.readOnly') : t('status.writable')}</span>
          </>
        ) : (
          <span>{t('status.closed')}</span>
        )}
      </div>
      {currentTable && (
        <div className="status-bar-section">
          <Icon name="table" size={12} />
          <span>{currentTable}</span>
        </div>
      )}
      {queryResults && queryResults.isQuery && (
        <div className="status-bar-section">
          <Icon name="rows" size={12} />
          <span>{queryResults.rows.length}</span>
          <span className="muted">/ {queryResults.totalRows}</span>
        </div>
      )}
      <div className="status-bar-right">
        {pendingEdits.length > 0 && (
          <div className="status-bar-section">
            <Icon name="edit" size={12} />
            <span>{t('status.editing', { count: pendingEdits.length })}</span>
          </div>
        )}
        {sqlExecuting && (
          <div className="status-bar-section">
            <Spinner size="sm" />
            <span>{t('progress.executing')}</span>
          </div>
        )}
        {progress && (
          <div className="status-bar-section">
            <span>{progress.phase}</span>
            <span className="muted">
              {progress.detail ? `${progress.detail} ` : ''}
              {Math.round(progress.progress * 100)}%
            </span>
          </div>
        )}
        {loading && <Spinner size="sm" />}
        <div className="status-bar-section">
          <Icon name="info" size={12} />
          <span>{languageLabel(state.language)}</span>
        </div>
      </div>
    </div>
  );
};

function languageLabel(lang: Language): string {
  return lang === 'zh-cn' ? '中文' : 'EN';
}

/**
 * Display label for each engine value.
 *
 * An explicit map rather than a ternary, so adding a dialect is a compile-time
 * error here instead of silently falling through to "SQLite".
 */
const ENGINE_LABEL_KEY: Record<DbEngine, 'engine.sqlite' | 'engine.libsql' | 'engine.turso'> = {
  sqlite: 'engine.sqlite',
  libsql: 'engine.libsql',
  turso: 'engine.turso'
};

function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const InfoDetail: React.FC<{ dbInfo: NonNullable<ReturnType<typeof useDatabaseState>['dbInfo']>; onClose: () => void }> = ({
  dbInfo,
  onClose
}) => {
  const { t } = useI18n();
  const caps = dbInfo.capabilities;
  // The bundled engine is always Turso Database, which is a superset of SQLite
  // and libSQL, so these capabilities are live for every file — they are NOT
  // gated on the detected dialect. `embeddedReplicas` stays false (that is a
  // Turso Cloud feature and this extension is local-file only).
  const anyCapability =
    caps.strictTables ||
    caps.alterColumn ||
    caps.vectorSearch ||
    caps.upsertReturning ||
    caps.nonConstantDefaults ||
    caps.sequences;
  return (
    <Modal title={t('info.title')} onClose={onClose} overlayClassName="modal-anchored">
      <InfoRow label={t('info.path')} value={dbInfo.path || '—'} />
      <InfoRow label={t('info.size')} value={formatBytes(dbInfo.sizeBytes)} />
      <InfoRow label={t('info.pageSize')} value={String(dbInfo.pageSize)} />
      <InfoRow label={t('info.encoding')} value={dbInfo.encoding} />
      <InfoRow label={t('info.writable')} value={dbInfo.writable ? t('yes') : t('no')} />
      {dbInfo.version && <InfoRow label={t('info.version')} value={dbInfo.version} />}
      <InfoRow label={t('info.driver')} value={dbInfo.driver} />
      <InfoRow label={t('info.engine')} value={t(ENGINE_LABEL_KEY[dbInfo.engine] ?? 'engine.sqlite')} />
      {dbInfo.detection.fallback && <InfoRow label={t('engine.evidence')} value={t('engine.libsql.fallback')} />}

      {anyCapability && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vscode-descriptionForeground)', marginBottom: 4 }}>
            {t('cap.title')}
          </div>
          <CapRow label={t('cap.strictTables')} enabled={caps.strictTables} />
          <CapRow label={t('cap.alterColumn')} enabled={caps.alterColumn} />
          <CapRow label={t('cap.vectorSearch')} enabled={caps.vectorSearch} />
          <CapRow label={t('cap.upsertReturning')} enabled={caps.upsertReturning} />
          <CapRow label={t('cap.embeddedReplicas')} enabled={caps.embeddedReplicas} />
          <CapRow label={t('cap.nonConstantDefaults')} enabled={caps.nonConstantDefaults} />
          <CapRow label={t('cap.sequences')} enabled={caps.sequences} />
          {caps.onlyFunctions.length > 0 && (
            <InfoRow label={t('cap.functions')} value={caps.onlyFunctions.join(', ')} />
          )}
        </div>
      )}
    </Modal>
  );
};

const CapRow: React.FC<{ label: string; enabled: boolean }> = ({ label, enabled }) => {
  const { t } = useI18n();
  return (
    <div style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
      <span style={{ flex: '0 0 100px', color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>{label}</span>
      <span
        style={{
          flex: 1,
          fontSize: 11,
          color: enabled ? 'var(--vscode-testing-icon-pass)' : 'var(--vscode-disabledForeground)',
          fontWeight: enabled ? 600 : 400
        }}
      >
        {enabled ? t('cap.enabled') : t('cap.disabled')}
      </span>
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--vscode-panel-border)' }}>
      <span style={{ flex: '0 0 100px', color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>{label}</span>
      <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
};
