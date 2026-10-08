// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef, useState } from 'react';
import type { ExportFormat, ImportFieldMapping, SqlValue } from '../../../src/shared/protocol';
import { bytesToHex, isNull, SQLITE_CAPABILITIES } from '../../../src/shared/protocol';
import type { NewTableField, NewTableOptions } from '../../../src/shared/ddl';
import { buildNewTablePlan } from '../../../src/shared/ddl';
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

  // Reset only when the dialog opens. `state` is deliberately NOT a dependency:
  // it is a fresh object every render (all hook returns are), so listing it made
  // this effect run after every render and immediately wipe the preview the
  // user had just loaded. The bridge identity is permanent (see useWebview), so
  // calling through it here cannot go stale.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (open) {
      setFormat('csv');
      setFilePath('');
      setError(null);
      stateRef.current.cancelImport();
    }
  }, [open]);

  if (!open) return null;

  const pickFile = async () => {
    setPicking(true);
    setError(null);
    try {
      // The host shows the native open dialog: a webview cannot open a file
      // picker itself (`window.prompt` returns null inside VS Code). An empty
      // path means the user dismissed the dialog — a normal outcome, silent
      // like any other cancelled dialog.
      const path = await state.pickImportFile();
      if (!path) return;
      setFilePath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

/* ------------------------------------------------------------------------ */
/* NewTableDialog                                                           */
/* ------------------------------------------------------------------------ */

export interface NewTableDialogProps {
  state: DatabaseState;
  open: boolean;
  onClose: () => void;
}

/** Raw text form state; numbers stay strings until submit so typing is free. */
interface NewTableForm {
  tableName: string;
  idColumn: string;
  autoIncrement: boolean;
  sequenceName: string;
  startValue: string;
  incrementBy: string;
  minValue: string;
  maxValue: string;
}

const EMPTY_FORM: NewTableForm = {
  tableName: '',
  idColumn: 'id',
  autoIncrement: true,
  sequenceName: '',
  startValue: '',
  incrementBy: '',
  minValue: '',
  maxValue: ''
};

/** Parse an optional numeric field; '' means "unset", junk becomes NaN. */
function optionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  return Number(trimmed);
}

/**
 * Create a new table.
 *
 * The SQL is not assembled here: `buildNewTablePlan` owns validation, capability
 * gating and generation, and this dialog REUSES that decision rather than
 * duplicating it — the confirm button is enabled only when the same function the
 * hook will call reports `ok`. That keeps the preview honest: what the user
 * reads in the preview is exactly what gets executed.
 *
 * Sequences are disabled rather than hidden. `CREATE SEQUENCE` is a Turso
 * Database extension, so no engine this extension currently drives can execute
 * it; the fields stay visible but inert so the capability is discoverable and
 * the UI needs no restructuring when such an engine is added.
 */
export const NewTableDialog: React.FC<NewTableDialogProps> = ({ state, open, onClose }) => {
  const { t } = useI18n();
  const [form, setForm] = useState<NewTableForm>(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const patch = (p: Partial<NewTableForm>) => setForm((f) => ({ ...f, ...p }));

  const options: NewTableOptions = {
    tableName: form.tableName,
    idColumn: form.idColumn,
    autoIncrement: form.autoIncrement,
    // A sequence is only ever sent when the user actually named one; the pure
    // layer treats "autoIncrement && sequenceName defined" as the request.
    sequenceName: form.autoIncrement && form.sequenceName.trim() !== '' ? form.sequenceName : undefined,
    startValue: optionalNumber(form.startValue),
    incrementBy: optionalNumber(form.incrementBy),
    minValue: optionalNumber(form.minValue),
    maxValue: optionalNumber(form.maxValue)
  };

  const capabilities = state.dbInfo?.capabilities ?? SQLITE_CAPABILITIES;
  // Sequences are a Turso Database extension. The flag comes from the reported
  // capabilities rather than the engine name, because libSQL and stock SQLite
  // are "SQLite family" too but cannot parse `CREATE SEQUENCE`.
  const sequencesSupported = capabilities.sequences === true;

  const plan = buildNewTablePlan(options, {
    engine: state.dbInfo?.engine ?? 'sqlite',
    capabilities,
    sequencesSupported,
    existingNames: state.objects.map((o) => o.name)
  });

  const errorKey = plan.ok ? null : plan.errorKey;
  const errorField = plan.ok ? null : plan.field;
  const preview = plan.ok ? plan.statements.join('\n') : '';

  /**
   * A field-level message, shown under the input it belongs to.
   *
   * Deliberately inline: the user is mid-edit, so a toast would be both easy to
   * miss and detached from the field that needs attention.
   */
  const fieldError = (field: NewTableField) =>
    errorField === field && errorKey ? <span className="field-help error-text">{t(errorKey)}</span> : null;

  // Errors that belong to no rendered input still have to be visible.
  const inlineField = errorField !== null && (errorField === 'tableName' || errorField === 'idColumn'
    || errorField === 'startValue' || errorField === 'incrementBy'
    || errorField === 'minValue' || errorField === 'maxValue');
  const generalError = errorKey && !inlineField ? t(errorKey) : null;

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // On success the hook closes this dialog, so there is nothing to do here.
      await state.createTable(options);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="modal-lg"
      title={t('newTable.title')}
      icon="plus"
      onClose={onClose}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={() => void submit()}
          cancelLabel={t('cancel')}
          confirmLabel={t('newTable.create')}
          confirmDisabled={!plan.ok || submitting}
          confirmLoading={submitting}
        />
      }
    >
      <DialogError error={submitError} />

      <div className="field-row">
        <Field label={t('newTable.tableName')}>
          <Input
            value={form.tableName}
            autoFocus
            onChange={(e) => patch({ tableName: e.target.value })}
            placeholder={t('newTable.tableNamePlaceholder')}
          />
          {fieldError('tableName')}
        </Field>
        <Field label={t('newTable.idColumn')}>
          <Input
            value={form.idColumn}
            onChange={(e) => patch({ idColumn: e.target.value })}
            placeholder={t('newTable.idColumnPlaceholder')}
          />
          {fieldError('idColumn')}
        </Field>
      </div>

      <CheckboxLine
        checked={form.autoIncrement}
        onChange={(v) => patch({ autoIncrement: v })}
        label={t('newTable.autoIncrement')}
      />

      {form.autoIncrement && (
        <div className="field-spaced">
          <Field label={t('newTable.sequence')} help={t('newTable.sequenceUnavailable')}>
            <Input
              value={form.sequenceName}
              disabled={!sequencesSupported}
              onChange={(e) => patch({ sequenceName: e.target.value })}
              placeholder={t('newTable.sequencePlaceholder')}
            />
          </Field>
          <div className="field-row">
            <Field label={t('newTable.startValue')}>
              <Input
                value={form.startValue}
                disabled={!sequencesSupported}
                onChange={(e) => patch({ startValue: e.target.value })}
                placeholder={t('newTable.defaultHint')}
              />
              {fieldError('startValue')}
            </Field>
            <Field label={t('newTable.incrementBy')}>
              <Input
                value={form.incrementBy}
                disabled={!sequencesSupported}
                onChange={(e) => patch({ incrementBy: e.target.value })}
                placeholder={t('newTable.defaultHint')}
              />
              {fieldError('incrementBy')}
            </Field>
          </div>
          <div className="field-row">
            <Field label={t('newTable.minValue')}>
              <Input
                value={form.minValue}
                disabled={!sequencesSupported}
                onChange={(e) => patch({ minValue: e.target.value })}
                placeholder={t('newTable.defaultHint')}
              />
              {fieldError('minValue')}
            </Field>
            <Field label={t('newTable.maxValue')}>
              <Input
                value={form.maxValue}
                disabled={!sequencesSupported}
                onChange={(e) => patch({ maxValue: e.target.value })}
                placeholder={t('newTable.defaultHint')}
              />
              {fieldError('maxValue')}
            </Field>
          </div>
        </div>
      )}

      {generalError && <div className="error-text field-spaced">{generalError}</div>}

      <Field label={t('newTable.preview')} className="field-spaced">
        <Textarea value={preview} readOnly rows={4} />
      </Field>
    </Modal>
  );
};
