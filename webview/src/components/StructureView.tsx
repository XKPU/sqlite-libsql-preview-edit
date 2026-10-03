// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { quoteIdent } from '../../../src/shared/protocol';
import { useI18n } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import {
  Badge,
  Button,
  CheckboxLine,
  DialogError,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  ModalActions,
  Select,
  Textarea,
  ToolbarCopyButton,
  Tooltip
} from './common';

/**
 * The column types offered when adding a column.
 *
 * A `const` rather than eight inline `<option>` elements, and the source of the
 * same list the Add Column dialog renders.
 */
const COLUMN_TYPES = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATETIME'] as const;

export interface StructureViewProps {
  state: DatabaseState;
}

export const StructureView: React.FC<StructureViewProps> = ({ state }) => {
  const { t } = useI18n();
  const { columns, createSql, currentTable, readOnly, loading } = state;
  const [showAdd, setShowAdd] = useState(false);
  const [showCreateIndex, setShowCreateIndex] = useState(false);

  if (!currentTable) {
    return <EmptyState icon="columns" message={t('tree.none')} />;
  }

  if (loading) {
    return <EmptyState message={t('msg.loading')} />;
  }

  return (
    <div className="structure">
      <div className="toolstrip">
        <div className="tool-group">
          <span className="tool-label">{t('struct.title')}</span>
          <span className="mono muted">{quoteIdent(currentTable)}</span>
        </div>
        <div className="tool-group">
          <Tooltip content={t('struct.addColumn')}>
            <Button variant="primary" icon="plus" onClick={() => setShowAdd(true)} disabled={readOnly}>
              {t('struct.addColumn')}
            </Button>
          </Tooltip>
          <Tooltip content={t('struct.createIndex')}>
            <Button variant="secondary" icon="index" onClick={() => setShowCreateIndex(true)} disabled={readOnly}>
              {t('struct.createIndex')}
            </Button>
          </Tooltip>
        </div>
        <div className="tool-group">
          <ToolbarCopyButton
            onClick={() => void navigator.clipboard.writeText(createSql)}
            disabled={!createSql}
            label={t('sql.copy')}
          />        </div>
      </div>

      <div className="structure-section">
        <div className="structure-section-header">
          <Icon name="columns" size={14} />
          <span>{t('struct.columns')}</span>
          <span className="muted">({columns.length})</span>
        </div>
        <div className="structure-section-body">
          <table className="structure-table">
            <thead>
              <tr>
                <th>{t('struct.name')}</th>
                <th>{t('struct.type')}</th>
                <th>{t('struct.notNull')}</th>
                <th>{t('struct.pk')}</th>
                <th>{t('struct.default')}</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.cid}>
                  <td className="mono">{c.name}</td>
                  <td className="mono muted">{c.type}</td>
                  <td>{c.notNull ? '✓' : '—'}</td>
                  <td>{c.pk ? <Badge variant="pk">PK</Badge> : '—'}</td>
                  <td className="mono">{c.defaultValue ?? '—'}</td>
                </tr>
              ))}
              {columns.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--vscode-descriptionForeground)' }}>
                    {t('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="structure-section">
        <div className="structure-section-header">
          <Icon name="sql" size={14} />
          <span>{t('struct.createSql')}</span>
        </div>
        <div className="code-block">{createSql || t('empty')}</div>
      </div>

      {showAdd && <AddColumnDialog state={state} onClose={() => setShowAdd(false)} />}
      {showCreateIndex && <CreateIndexDialog state={state} onClose={() => setShowCreateIndex(false)} />}
    </div>
  );
};

const AddColumnDialog: React.FC<{ state: DatabaseState; onClose: () => void }> = ({ state, onClose }) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState('TEXT');
  const [notNull, setNotNull] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    if (!name.trim()) {
      setError(t('struct.columnName'));
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const sql = `ALTER TABLE ${quoteIdent(state.currentTable!)} ADD COLUMN ${quoteIdent(name.trim())} ${type}${
        notNull ? ' NOT NULL' : ''
      }${defaultValue.trim() ? ` DEFAULT ${defaultValue.trim()}` : ''}`;
      await state.executeDdl([sql]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={`${t('struct.addColumn')}: ${state.currentTable}`}
      icon="plus"
      onClose={onClose}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={() => void apply()}
          cancelLabel={t('struct.cancel')}
          confirmLabel={t('struct.apply')}
          confirmDisabled={applying || !name.trim()}
          confirmLoading={applying}
          cancelDisabled={applying}
        />
      }
    >
      <Field label={t('struct.columnName')}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder={t('struct.columnNamePlaceholder')}
        />
      </Field>
      <Field label={t('struct.columnType')}>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {COLUMN_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {ct}
            </option>
          ))}
          <option value="">{t('struct.typeNone')}</option>
        </Select>
      </Field>
      <CheckboxLine checked={notNull} onChange={setNotNull} label={t('struct.notNull')} />
      <Field label={t('struct.defaultValue')} className="field-spaced">
        <Textarea
          value={defaultValue}
          onChange={(e) => setDefaultValue(e.target.value)}
          rows={2}
          placeholder={t('struct.defaultPlaceholder')}
        />
      </Field>
      <DialogError error={error} />
    </Modal>
  );
};

const CreateIndexDialog: React.FC<{ state: DatabaseState; onClose: () => void }> = ({ state, onClose }) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    if (!name.trim() || columns.length === 0) {
      setError('Name and at least one column are required');
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const colList = columns.map((c) => quoteIdent(c)).join(', ');
      const sql = `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(name.trim())} ON ${quoteIdent(
        state.currentTable!
      )} (${colList})`;
      await state.executeDdl([sql]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      title={`${t('struct.createIndex')} on ${state.currentTable}`}
      icon="index"
      onClose={onClose}
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={() => void apply()}
          cancelLabel={t('struct.cancel')}
          confirmLabel={t('struct.apply')}
          confirmDisabled={applying || !name.trim() || columns.length === 0}
          confirmLoading={applying}
          cancelDisabled={applying}
        />
      }
    >
      <Field label={t('struct.name')}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder={t('struct.indexNamePlaceholder')}
        />
      </Field>
      <Field label={t('struct.columns')}>
        <div className="checkbox-row">
          {state.columns.map((c) => (
            <CheckboxLine
              key={c.cid}
              checked={columns.includes(c.name)}
              onChange={(on) =>
                setColumns((prev) => (on ? [...prev, c.name] : prev.filter((x) => x !== c.name)))
              }
              label={<span className="mono">{c.name}</span>}
            >
              <span className="muted">{c.type}</span>
            </CheckboxLine>
          ))}
        </div>
      </Field>
      <CheckboxLine checked={unique} onChange={setUnique} label="UNIQUE" />
      <DialogError error={error} />
    </Modal>
  );
};
