import React, { useCallback } from 'react';
import type { SqlValue } from '../../../src/shared/protocol';
import { bytesToHex, isNull } from '../../../src/shared/protocol';
import { useI18n } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import { Badge, EmptyState, Icon, Spinner, ToolbarIconButton } from './common';

export interface SqlResultProps {
  state: DatabaseState;
}

export const SqlResult: React.FC<SqlResultProps> = ({ state }) => {
  const { t } = useI18n();
  const { settings, sqlExecuting, sqlError } = state;
  const results = state.queryResults;

  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      if (!results || !results.isQuery) return;
      // Build a CSV/JSON export of the current result set via the host.
      // We rely on startExport('sql') -> dialog; but for quick export just
      // trigger doExport with the raw rows as JSON/CSV.
      // Simpler: use copy-to-clipboard as a fallback.
      if (format === 'json') {
        const text = JSON.stringify(results.rows, (_k, v) => (v instanceof Uint8Array ? bytesToHex(v) : v));
        void navigator.clipboard.writeText(text);
        state.addToast('success', t('sql.copyResult'));
      } else {
        const header = results.columns.map((c) => c.name).join(',');
        const rows = results.rows.map((r) =>
          r.map((v) => {
            if (v === null) return '';
            if (v instanceof Uint8Array) return bytesToHex(v);
            const s = String(v);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
            return s;
          }).join(',')
        );
        void navigator.clipboard.writeText([header, ...rows].join('\n'));
        state.addToast('success', t('sql.copyResult'));
      }
    },
    [results, state, t]
  );

  const handleCopyError = useCallback(() => {
    if (!sqlError) return;
    const text = `${sqlError.message}${sqlError.sql ? `\n${sqlError.sql}` : ''}`;
    void navigator.clipboard.writeText(text);
    state.addToast('success', t('sql.errorCopy'));
  }, [sqlError, state, t]);

  if (sqlExecuting) {
    return (
      <div className="sql-result">
        <Spinner label={t('progress.executing')} />
      </div>
    );
  }

  if (sqlError) {
    return (
      <div className="sql-result">
        <div className="sql-result-summary error-text">
          <Icon name="warning" size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          <span>{t('sql.error')}</span>
          <span style={{ flex: 1 }} />
          <ToolbarIconButton icon="copy" onClick={handleCopyError} label={t('sql.errorCopy')} />
        </div>
        <pre className="error-text" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: '4px 8px' }}>
          {sqlError.message}
        </pre>
        {sqlError.line !== undefined && (
          <div className="muted" style={{ padding: '0 8px', fontSize: 11 }}>
            {t('sql.errorLine', { line: sqlError.line, col: sqlError.column ?? 0 })}
          </div>
        )}
        {sqlError.sql && (
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', margin: 0, padding: '4px 8px', fontSize: 11 }}>
            {sqlError.sql}
          </pre>
        )}
      </div>
    );
  }

  if (!results) {
    return (
      <div className="sql-result">
        <EmptyState icon="sql" iconSize={32} message={t('sql.execute')} />
      </div>
    );
  }

  if (!results.isQuery) {
    const affected = results.affectedRows ?? 0;
    return (
      <div className="sql-result">
        <div className="sql-result-summary">
          <Icon name="check" size={14} style={{ verticalAlign: '-2px', marginRight: 4, color: 'var(--vscode-charts-green)' }} />
          {t('sql.rowsAffected', { count: affected, ms: results.durationMs })}
        </div>
      </div>
    );
  }

  return (
    <div className="sql-result">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span className="muted">
          {t('sql.result')}: {results.rows.length} rows, {results.columns.length} columns
        </span>
        <span style={{ flex: 1 }} />
        <ToolbarIconButton icon="export" onClick={() => handleExport('csv')} label={t('sql.exportCsv')} />
        <ToolbarIconButton icon="export" onClick={() => handleExport('json')} label={t('sql.exportJson')} />
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {results.columns.map((c) => (
                <th key={c.name}>
                  <span>{c.name}</span>
                  <Badge style={{ marginLeft: 4, fontSize: 9 }}>{c.type}</Badge>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((cells, ri) => (
              <tr key={ri}>
                {cells.map((v, ci) => (
                  <td key={ci}>{renderValue(v, settings)}</td>
                ))}
              </tr>
            ))}
            {results.rows.length === 0 && (
              <tr>
                <td colSpan={results.columns.length} style={{ padding: 16, textAlign: 'center', color: 'var(--vscode-descriptionForeground)' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function renderValue(value: SqlValue, settings: { nullDisplay: string; maxCellLength: number }): React.ReactNode {
  if (isNull(value)) {
    return <span className="cell-null">{settings.nullDisplay || 'NULL'}</span>;
  }
  if (value instanceof Uint8Array) {
    const hex = bytesToHex(value);
    return <span className="cell-blob">{hex}</span>;
  }
  if (typeof value === 'boolean') {
    return <span>{value ? 'TRUE' : 'FALSE'}</span>;
  }
  let s = String(value);
  if (s.length > settings.maxCellLength) {
    s = s.slice(0, settings.maxCellLength) + '…';
  }
  return s;
}
