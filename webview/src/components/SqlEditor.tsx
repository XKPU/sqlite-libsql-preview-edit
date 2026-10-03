// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import { Button, Spinner, ToolbarIconButton } from './common';

export interface SqlEditorProps {
  state: DatabaseState;
}

export const SqlEditor: React.FC<SqlEditorProps> = ({ state }) => {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectionSql, setSelectionSql] = useState('');

  const { sqlText, sqlExecuting } = state;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const newValue = sqlText.slice(0, start) + '  ' + sqlText.slice(end);
        state.setSqlText(newValue);
        requestAnimationFrame(() => {
          el.focus();
          el.selectionStart = el.selectionEnd = start + 2;
        });
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        state.runAllSql();
      } else if (e.altKey && e.key === 'Enter') {
        e.preventDefault();
        const selected = sqlText.slice(el.selectionStart, el.selectionEnd).trim();
        if (selected) {
          state.runSelection(selected);
        } else {
          state.runAllSql();
        }
      }
    },
    [sqlText, state]
  );

  const handleSelect = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const selected = sqlText.slice(el.selectionStart, el.selectionEnd).trim();
    setSelectionSql(selected);
  }, [sqlText]);

  const handleClear = useCallback(() => state.clearSql(), [state]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(sqlText);
  }, [sqlText]);

  const selectionDisabled = selectionSql.length === 0;

  return (
    <div className="sql-editor">
      <div className="toolstrip">
        <div className="tool-group">
          <Button
            variant="primary"
            icon="play"
            onClick={state.runAllSql}
            disabled={sqlExecuting || sqlText.trim().length === 0}
          >
            {t('sql.runAll')}
          </Button>
          <Button
            variant="secondary"
            icon="play-selection"
            onClick={() => {
              if (!selectionDisabled) state.runSelection(selectionSql);
            }}
            disabled={sqlExecuting || selectionDisabled}
          >
            {t('sql.runSelection')}
          </Button>
        </div>
        <div className="tool-group">
          <ToolbarIconButton
            icon="copy"
            onClick={handleCopy}
            disabled={sqlText.length === 0}
            label={t('sql.copy')}
          />
          <ToolbarIconButton
            icon="clear"
            onClick={handleClear}
            disabled={sqlText.length === 0}
            label={t('sql.clear')}
          />
        </div>
        <div className="tool-group">
          <ToolbarIconButton
            icon="export"
            onClick={() => state.startExport('sql')}
            disabled={state.queryResults?.isQuery !== true}
            label={t('sql.exportCsv')}
          />
        </div>
        {sqlExecuting && <Spinner size="sm" label={t('progress.executing')} />}
      </div>
      <textarea
        ref={textareaRef}
        className="sql-editor-textarea"
        value={sqlText}
        onChange={(e) => state.setSqlText(e.target.value)}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        spellCheck={false}
        placeholder={t('sql.editorTitle')}
        aria-label={t('sql.editorTitle')}
      />
    </div>
  );
};
