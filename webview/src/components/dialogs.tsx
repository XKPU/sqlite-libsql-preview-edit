// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from 'react';
import type { ExportFormat, ImportFieldMapping, SqlValue } from '../../../src/shared/protocol';
import { bytesToHex, isNull } from '../../../src/shared/protocol';
import { useI18n } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import {
  Button,
  CheckboxLine,
  DialogError,
  Field,
  Input,
  Modal,
  ModalActions,
  Select,
  Textarea
} from './common';

/* ------------------------------------------------------------------------ */
/* ExportDialog                                                             */
/* ------------------------------------------------------------------------ */

export interface ExportDialogProps {
  state: DatabaseState;
  open: boolean;
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ state, open, onClose }) => {
  const { t } = useI18n();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selectSql, setSelectSql] = useState('');
  const [scope, setScope] = useState<'table' | 'database' | 'sql'>('table');

  useEffect(() => {
    if (open) {
      setScope(state.exportScope);
      setSelectSql(state.sqlText || '');
      setFormat('csv');
    }
  }, [open, state.exportScope, state.sqlText]);

  if (!open) return null;

  const doExport = async () => {
    try {
      await state.doExport(format, scope === 'sql' ? selectSql : undefined);
    } catch (e) {
      state.addToast('error', e instanceof Error ? e.message : String(e));
    }
  };

  const ext = format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'sql';
  const suggestedName = `${state.currentTable || 'export'}.${ext}`;

  return (
    <Modal
      title={t('export.title')}
      icon="export"
      onClose={onClose}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={() => void doExport()}
          cancelLabel={t('cancel')}
          confirmLabel={t('export.title')}
        />
      }
    >
      <Field label={t('export.format')}>
        <Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          <option value="csv">{t('export.csv')}</option>
          <option value="json">{t('export.json')}</option>
          <option value="sql">{t('export.sql')}</option>
        </Select>
      </Field>

      <Field label={t('export.scope')}>
        <Select value={scope} onChange={(e) => setScope(e.target.value as 'table' | 'database' | 'sql')}>
          <option value="table">{t('export.table')}</option>
          <option value="database">{t('export.database')}</option>
          <option value="sql">{t('sql.execute')}</option>
        </Select>
      </Field>

      {scope === 'sql' && (
        <Field label="SQL">
          <Textarea
            value={selectSql}
            onChange={(e) => setSelectSql(e.target.value)}
            rows={4}
            className="mono"
          />
        </Field>
      )}

      <Field label={t('export.choosePath')} help={t('export.pathHint')}>
        <Input icon="file" value={suggestedName} readOnly disabled />
      </Field>
    </Modal>
  );
};

/* ------------------------------------------------------------------------ */
/* ImportDialog                                                             */
/* ------------------------------------------------------------------------ */

export interface ImportDialogProps {
  state: DatabaseState;
  open: boolean;
  onClose: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({ state, open, onClose }) => {
  const { t } = useI18n();
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [filePath, setFilePath] = useState('');
  const [picking, setPicking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormat('csv');
      setFilePath('');
      setError(null);
      state.cancelImport();
    }
  }, [open, state]);

  if (!open) return null;

  const pickFile = async () => {
    setPicking(true);
    setError(null);
    try {
      // The host handles file picker via executeSql? No - we use a
      // dedicated dialog through host. But our protocol only has
      // importPreview which requires filePath. Use a fallback: prompt
      // via a simple modal input for the path.
      const path = window.prompt('Enter the file path (or leave empty to cancel):');
      if (!path) return;
      setFilePath(path.trim());
    } finally {
      setPicking(false);
    }
  };

  const previewFile = async () => {
    if (!filePath.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      await state.importPreview(filePath.trim(), format);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const commit = async () => {
    if (!state.importPreviewState) return;
    setCommitting(true);
    setError(null);
    try {
      await state.commitImport();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const importPreview = state.importPreviewState;
  const targetColumns = state.columns.map((c) => c.name);
  const targetTable = state.activeImportTable || state.currentTable || '';

  return (
    <Modal
      className="modal-lg"
      title={`${t('import.title')}${targetTable ? ` → ${targetTable}` : ''}`}
      icon="import"
      onClose={onClose}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={() => void commit()}
          cancelLabel={t('import.cancel')}
          confirmLabel={t('import.importing')}
          confirmDisabled={!importPreview || committing || !targetTable.trim()}
          confirmLoading={committing}
        />
      }
    >
      <div className="field-row">
        <Field label={t('export.format')}>
          <Select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
        </Field>
        <Field label={t('import.tableName')}>
          <Input
            value={targetTable}
            onChange={(e) => state.setImportTableName(e.target.value)}
            placeholder={t('import.tableNamePlaceholder')}
          />
        </Field>
      </div>

      <Field label={t('import.file')}>
        <div className="input-with-button">
          <Input
            icon="file"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder={t('import.filePlaceholder')}
            disabled={picking || previewing || committing}
          />
          <Button variant="secondary" onClick={() => void pickFile()} loading={picking} icon="search">
            {t('export.choosePath')}
          </Button>
        </div>
      </Field>

      <CheckboxLine
        checked={importPreview?.createTable ?? true}
        onChange={state.setImportCreateTable}
        disabled={!importPreview}
        label={t('import.createNew')}
      />

      <Field label={t('import.conflict')} className="field-spaced">
        <Select
          value={importPreview?.conflict || 'skip'}
          onChange={(e) => state.setImportConflict(e.target.value as 'skip' | 'replace' | 'fail')}
          disabled={!importPreview}
        >
          <option value="skip">{t('import.conflictSkip')}</option>
          <option value="replace">{t('import.conflictReplace')}</option>
          <option value="fail">{t('import.conflictFail')}</option>
        </Select>
      </Field>

      {!importPreview && (
        <Button
          variant="primary"
          icon="search"
          onClick={previewFile}
          disabled={previewing || !filePath.trim()}
          loading={previewing}
          className="field-spaced"
        >
          {t('import.preview')}
        </Button>
      )}

      {importPreview && <ImportPreviewTables preview={importPreview} targetColumns={targetColumns} state={state} />}

      <DialogError error={error} />
    </Modal>
  );
};

/**
 * The mapping and sample-row tables shown once a file has been previewed.
 *
 * Split out of `ImportDialog` so neither function has to hold both the file
 * picking flow and two nested tables at once.
 */
const ImportPreviewTables: React.FC<{
  preview: NonNullable<DatabaseState['importPreviewState']>;
  targetColumns: string[];
  state: DatabaseState;
}> = ({ preview, targetColumns, state }) => {
  const { t } = useI18n();
  return (
    <div className="field-spaced">
      <div className="field-label preview-label">{t('import.preview')}</div>
      <div className="import-preview">
        <div className="import-preview-scroll">
          <table className="import-preview-table">
            <thead>
              <tr>
                <th>{t('import.field')}</th>
                <th>{t('import.target')}</th>
                <th>{t('import.type')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.mappings.map((m: ImportFieldMapping, i) => (
                <tr key={i}>
                  <td className="mono">{m.source}</td>
                  <td>
                    <Select
                      value={m.target}
                      onChange={(e) => state.setImportMapping(i, e.target.value, m.inferredType)}
                    >
                      <option value="">{t('import.skipField')}</option>
                      {targetColumns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="mono muted">{m.inferredType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview.previewRows && preview.previewRows.length > 0 && (
        <Field label={t('import.sampleRows')} className="field-spaced">
          <div className="import-preview import-preview-scroll import-preview-short">
            <table className="import-preview-table">
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.slice(0, 5).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((v, ci) => (
                      <td key={ci} className="mono">
                        {formatImportValue(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Field>
      )}
    </div>
  );
};

function formatImportValue(v: SqlValue): string {
  if (isNull(v)) return 'NULL';
  if (v instanceof Uint8Array) return bytesToHex(v);
  return String(v);
}
