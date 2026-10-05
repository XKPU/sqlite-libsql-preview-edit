// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import { Icon, ToolbarCopyButton } from './common';

export interface SequenceViewProps {
  state: DatabaseState;
}

export const SequenceView: React.FC<SequenceViewProps> = ({ state }) => {
  const { t } = useI18n();
  const obj = state.currentObject;

  const name = obj?.kind === 'sequence' ? obj.name : '';
  const value = obj?.kind === 'sequence' && typeof obj.seq === 'number' ? obj.seq : null;
  const placeholder = t('empty');

  // `key` is typed as `MessageKey` so the literal is preserved: `t()` only
  // accepts catalogued keys, so an untranslated row label becomes a build error
  // instead of leaking a raw key into the UI.
  const rows: Array<{ key: MessageKey; value: string | number | null }> = [
    { key: 'seq.name', value: name },
    { key: 'seq.value', value: value ?? null },
    { key: 'seq.min', value: null },
    { key: 'seq.max', value: null },
    { key: 'seq.increment', value: null }
  ];

  return (
    <div className="structure-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div className="toolstrip" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="sequence" size={14} />
        <span className="section-title">{t('seq.title')}</span>
        <span className="muted">{t('seq.note')}</span>
        <div className="spacer" />
      </div>

      <div className="property-grid">
        {rows.map((row) => (
          <div className="property-row" key={row.key}>
            <span className="property-label">{t(row.key)}</span>
            <div className="property-value" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <span>{row.value === null || row.value === '' ? placeholder : String(row.value)}</span>
              {row.value !== null && row.value !== '' ? (
                <ToolbarCopyButton
                  label={t('sql.copy')}
                  onClick={() => void navigator.clipboard.writeText(String(row.value))}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
