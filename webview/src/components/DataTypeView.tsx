// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { useI18n } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import { Badge, Icon } from './common';

export interface DataTypeViewProps {
  state: DatabaseState;
}

/**
 * The declared SQLite type name and the affinity SQLite actually applies to it
 * (see the "Type Affinity" rules: INT → INTEGER, CHAR/CLOB/TEXT → TEXT,
 * BLOB or no type → BLOB, REAL/FLOA/DOUB → REAL, everything else → NUMERIC).
 *
 * `affinity` used to be omitted here while the row renderer read it, which is
 * exactly what the declared type and the stored type differ by, so every entry
 * now states it explicitly.
 */
interface DataTypeRow {
  name: string;
  affinity: string;
  size: string;
  example: string;
  note: string;
}

const DATA_TYPES: DataTypeRow[] = [
  { name: 'INTEGER', affinity: 'INTEGER', note: '整型，常用主键 / 计数', example: '123', size: '1–8 bytes' },
  { name: 'TEXT', affinity: 'TEXT', note: '文本，适合字符串 / 标识符', example: "'abc'", size: 'variable' },
  { name: 'REAL', affinity: 'REAL', note: '浮点数值，适合度量', example: '3.14', size: '8 bytes' },
  { name: 'BLOB', affinity: 'BLOB', note: '二进制数据 / 任意字节', example: "x'00ff'", size: 'variable' },
  { name: 'NUMERIC', affinity: 'NUMERIC', note: '数字亲和性，常见于金额 / 日期', example: '99.50', size: 'variable' },
  { name: 'DATETIME', affinity: 'NUMERIC', note: '时间戳语义，存储为 TEXT / NUMERIC', example: "2026-07-21", size: 'variable' },
  { name: 'BOOLEAN', affinity: 'NUMERIC', note: '布尔语义，存储为 0 / 1', example: '1', size: '1 byte' }
];

export const DataTypeView: React.FC<DataTypeViewProps> = () => {
  const { t } = useI18n();
  return (
    <div className="structure">
      <div className="toolstrip">
        <div className="tool-group">
          <span className="tool-label">{t('dt.title')}</span>
          <span className="mono muted">{t('dt.subtitle')}</span>
        </div>
        <div className="tool-group">
          <span className="tool-label">
            <Badge variant="pk">{t('dt.affinity')}</Badge>
          </span>
        </div>
      </div>

      <div className="structure-section">
        <div className="structure-section-header">
          <Icon name="dataType" size={14} />
          <span>{t('dt.types')}</span>
          <span className="muted">({DATA_TYPES.length})</span>
        </div>
        <div className="structure-section-body">
          <table className="structure-table">
            <thead>
              <tr>
                <th>{t('dt.name')}</th>
                <th>{t('dt.affinity')}</th>
                <th>{t('dt.size')}</th>
                <th>{t('dt.example')}</th>
                <th>{t('dt.note')}</th>
              </tr>
            </thead>
            <tbody>
              {DATA_TYPES.map((row) => (
                <tr key={row.name}>
                  <td className="mono">{row.name}</td>
                  <td className="mono muted">{row.affinity}</td>
                  <td className="mono muted">{row.size}</td>
                  <td className="mono">{row.example}</td>
                  <td>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="structure-section">
        <div className="structure-section-header">
          <Icon name="sql" size={14} />
          <span>{t('dt.usage')}</span>
        </div>
        <div className="code-block">CREATE TABLE example (id INTEGER PRIMARY KEY, name TEXT, amount REAL);</div>
      </div>
    </div>
  );
};
