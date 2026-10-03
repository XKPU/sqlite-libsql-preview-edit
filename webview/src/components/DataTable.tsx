// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { CellEdit, ColumnInfo, QueryResult, SqlValue } from '../../../src/shared/protocol';
import { bytesToHex, isNull, rowEditKey } from '../../../src/shared/protocol';
import { useI18n } from '../i18n';
import type { DatabaseState, RowEditState } from '../hooks/useDatabaseState';
import { Badge, Button, EmptyState, Icon, Input, Select, ToolbarIconButton } from './common';

export interface DataTableProps {
  state: DatabaseState;
}

function parseCellInput(value: string, column: ColumnInfo): SqlValue {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null;
  const declaredType = column.type.toUpperCase();
  if (
    declaredType.includes('INT') ||
    declaredType.includes('REAL') ||
    declaredType.includes('FLOAT') ||
    declaredType.includes('DOUBLE') ||
    declaredType.includes('NUMERIC') ||
    declaredType.includes('DECIMAL') ||
    declaredType.includes('BOOLEAN')
  ) {
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    if (/^-?\d*\.\d+$/.test(trimmed)) return parseFloat(trimmed);
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
  }
  return value;
}

export const DataTable: React.FC<DataTableProps> = ({ state }) => {
  const { t } = useI18n();
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editingInputRef = useRef<HTMLInputElement>(null);

  const {
    columns,
    queryResults,
    pendingEdits,
    readOnly,
    page,
    filters,
    search,
    sort,
    currentTable,
    settings,
    loading,
    rowCells,
    rowKeys
  } = state;

  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);

  const results = queryResults as QueryResult | null;

  const hasEdits = pendingEdits.length > 0;
  const hasPendingInserts = pendingEdits.some((e) => e.isNew);

  const pageRows = results ? results.rows.length : 0;
  const totalRows = results ? (results.totalRows ?? pageRows) : 0;

  const hasPk = useMemo(
    () => columns.some((c) => c.pk && !c.hidden),
    [columns]
  );

  const findEdit = useCallback(
    (rowIndex: number): RowEditState | undefined => {
      if (!currentTable || !rowKeys) return undefined;
      const key = rowKeys[rowIndex];
      if (!key) return undefined;
      return pendingEdits.find(
        (e) => rowEditKey(e.key.table, e.key.keyColumns, e.key.keyValues) === rowEditKey(currentTable, key.columns, key.values)
      );
    },
    [currentTable, rowKeys, pendingEdits]
  );

  const getCellEdit = useCallback(
    (rowIndex: number, columnName: string): CellEdit | undefined => {
      const edit = findEdit(rowIndex);
      if (!edit) return undefined;
      return edit.edits.find((ed) => ed.column === columnName);
    },
    [findEdit]
  );

  const handleDoubleClick = useCallback(
    (rowIndex: number, columnName: string, currentValue: SqlValue) => {
      if (readOnly) return;
      const display = isNull(currentValue) ? '' : valueForCell(currentValue, settings);
      setEditingCell({ row: rowIndex, col: columnName });
      setEditingValue(display);
      setTimeout(() => editingInputRef.current?.focus(), 0);
    },
    [readOnly, settings]
  );

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const col = columns.find((c) => c.name === editingCell.col);
    const newValue = col ? parseCellInput(editingValue, col) : editingValue;
    state.setCellEdit(editingCell.row, editingCell.col, newValue);
    setEditingCell(null);
    setEditingValue('');
  }, [editingCell, columns, state, editingValue]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditingValue('');
  }, []);

  const handleEnter = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit]
  );

  if (!currentTable) {
    return <EmptyState icon="table" message={t('tree.none')} />;
  }

  if (!results) {
    return <EmptyState loading={loading} message={t('msg.loading')} />;
  }

  const headerCell = (col: ColumnInfo) => {
    const isSorted = sort.column === col.name;
    const sortDir = sort.dir;
    const hasFilter = filters[col.name] !== undefined && filters[col.name] !== '';
    return (
      <th key={col.name} onClick={() => state.setSort(col.name, isSorted && sortDir === 'asc' ? 'desc' : 'asc')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{col.name}</span>
          {col.pk && !col.hidden && <Badge variant="pk">PK</Badge>}
          {!col.notNull && <Badge variant="null">N</Badge>}
          <span className="sort-indicator">
            {isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Select
            className="col-filter-select"
            value={filters[col.name] || ''}
            onChange={(e) => state.setColumnFilter(col.name, e.target.value)}
            aria-label={t('data.columnFilter', { column: col.name })}
            disabled={readOnly ? false : false}
          >
            <option value="">{t('data.columnFilter', { column: col.name })}</option>
            {Array.from({ length: 20 }).map((_, i) => {
              return <option key={i} value={`%_${i}`}>%_{i}</option>;
            })}
          </Select>
          {hasFilter && (
            <span className="col-filter-clear" onClick={() => state.clearColumnFilter(col.name)} title={t('cancel')}>
              <Icon name="close" size={10} />
            </span>
          )}
        </div>
      </th>
    );
  };

  const renderCell = (rowIndex: number, col: ColumnInfo, value: SqlValue) => {
    const isEditing = editingCell?.row === rowIndex && editingCell?.col === col.name;
    if (isEditing) {
      return (
        <input
          ref={editingInputRef}
          className="cell-input"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleEnter}
        />
      );
    }
    if (isNull(value)) {
      return (
        <span className="cell-null">{settings.nullDisplay || t('data.null')}</span>
      );
    }
    if (value instanceof Uint8Array) {
      const hex = bytesToHex(value);
      return <span className="cell-blob" title={hex}>{hex}</span>;
    }
    if (typeof value === 'boolean') {
      return <span>{value ? 'TRUE' : 'FALSE'}</span>;
    }
    return <span>{String(value)}</span>;
  };

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div className="toolstrip">
        <div className="tool-group">
          <Input
            icon="search"
            placeholder={t('data.search')}
            value={search}
            onChange={(e) => state.setRowFilter(e.target.value)}
            style={{ width: 220 }}
          />
        </div>
        <div className="tool-group">
          <ToolbarIconButton
            icon="plus"
            disabled={readOnly || hasPendingInserts}
            onClick={() => state.addRow()}
            label={t('data.addRow')}
          />
          <ToolbarIconButton
            variant="primary"
            icon="save"
            disabled={readOnly || !hasEdits}
            onClick={() => void state.save()}
            label={t('data.save')}
          />
          <ToolbarIconButton
            icon="rollback"
            disabled={readOnly || !hasEdits}
            onClick={() => state.rollback()}
            label={t('data.rollback')}
          />
        </div>
        <div className="tool-group">
          <ToolbarIconButton
            icon="duplicate"
            disabled={readOnly}
            onClick={() => {
              if (editingCell) return;
              // duplicate first visible row
              if (rowCells && rowCells.length > 0) void state.duplicateRow(0);
            }}
            label={t('data.duplicateRow')}
          />
        </div>
        {hasEdits && (
          <div className="tool-group">
            <span className="tool-label">
              <Badge variant="warning">{t('status.editing', { count: pendingEdits.length })}</Badge>
            </span>
          </div>
        )}
      </div>

      {/* Warnings */}
      {!hasPk && !readOnly && (
        <div className="banner">
          <Icon name="warning" size={14} />
          <span>{t('data.noPk')}</span>
        </div>
      )}

      {readOnly && (
        <div className="banner banner-info">
          <Icon name="database-locked" size={14} />
          <span>{t('status.readOnly')}</span>
        </div>
      )}

      {/* Table */}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="cell-index">#</th>
              {visibleColumns.map((c) => headerCell(c))}
              {/* Row actions: delete a row, or undo a staged delete. Without this
                  column the delete path was implemented but unreachable. */}
              <th className="cell-actions" aria-label={t('data.actions')} />
            </tr>
          </thead>
          <tbody>
            {results.rows.map((cells, ri) => {
              const edit = findEdit(ri);
              return (
                <tr key={ri} style={{ position: 'relative' }}>
                  <td className="cell-index">{ri + 1}</td>
                  {visibleColumns.map((col, ci) => {
                    const cellEdit = getCellEdit(ri, col.name);
                    const displayValue: SqlValue = edit?.isNew
                      ? cellEdit
                        ? cellEdit.value
                        : null
                      : cells[ci] ?? null;
                    const cls = ['cell'];
                    if (edit?.isNew) cls.push('cell-new');
                    else if (edit?.isDeleted) cls.push('cell-deleted');
                    else if (cellEdit) cls.push('cell-modified');
                    return (
                      <td
                        key={col.name}
                        className={cls.join(' ')}
                        onDoubleClick={() => !edit?.isNew && !edit?.isDeleted && handleDoubleClick(ri, col.name, displayValue)}
                        title={isNull(displayValue) ? t('data.null') : String(displayValue)}
                      >
                        {renderCell(ri, col, displayValue)}
                      </td>
                    );
                  })}
                  <td className="cell-actions">
                    {edit?.isDeleted ? (
                      <ToolbarIconButton
                        size="sm"
                        icon="rollback"
                        onClick={() => state.restoreDeletedRow(ri)}
                        label={t('data.restoreRow')}
                      />
                    ) : (
                      <ToolbarIconButton
                        size="sm"
                        icon="trash"
                        // Deleting needs a primary key to identify the row, and
                        // is blocked for read-only files and unsaved inserts.
                        disabled={readOnly || !hasPk || !!edit?.isNew}
                        onClick={() => state.deleteRow(ri)}
                        label={t('data.deleteRow')}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {results.rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 2} style={{ padding: 16, textAlign: 'center', color: 'var(--vscode-descriptionForeground)' }}>
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pagination">
        <Button variant="icon" icon="chevron-left" onClick={() => state.prevPage()} disabled={page.page === 0} aria-label={t('data.prev')} />
        <span>
          {t('data.page')} {page.page + 1} {t('data.of')} {Math.max(1, Math.ceil(totalRows / page.pageSize))}
        </span>
        <Button variant="icon" icon="chevron-right" onClick={() => state.nextPage()} disabled={(page.page + 1) * page.pageSize >= totalRows} aria-label={t('data.next')} />
        <span className="pagination-info">
          {t('data.rows', { count: pageRows })} / {t('data.rows.total', { count: totalRows })}
        </span>
      </div>
    </div>
  );
};

function valueForCell(value: SqlValue, settings: { nullDisplay: string; maxCellLength: number }): string {
  if (isNull(value)) return '';
  if (value instanceof Uint8Array) return bytesToHex(value);
  let s = String(value);
  if (s.length > settings.maxCellLength) {
    s = s.slice(0, settings.maxCellLength) + '…';
  }
  return s;
}
