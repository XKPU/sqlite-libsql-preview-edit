// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useRef, useState } from 'react';
import type { ObjectInfo } from '../../../src/shared/protocol';
import { useI18n } from '../i18n';
import type { DatabaseState } from '../hooks/useDatabaseState';
import { Badge, ContextMenu, Icon, Input, ToolbarIconButton, type ContextMenuItem } from './common';

export interface ObjectTreeProps {
  state: DatabaseState;
}

interface GroupItem {
  kind: 'table' | 'view' | 'index' | 'trigger' | 'sequence' | 'dataType';
  icon: 'table' | 'view' | 'index' | 'trigger' | 'sequence' | 'dataType';
  labelKey: 'tree.tables' | 'tree.views' | 'tree.indexes' | 'tree.triggers' | 'tree.sequences' | 'tree.dataTypes';
}

const DATA_TYPE_ITEMS: ObjectInfo[] = [
  { name: 'INTEGER', type: 'dataType' },
  { name: 'TEXT', type: 'dataType' },
  { name: 'REAL', type: 'dataType' },
  { name: 'BLOB', type: 'dataType' },
  { name: 'NUMERIC', type: 'dataType' },
  { name: 'DATETIME', type: 'dataType' },
  { name: 'BOOLEAN', type: 'dataType' }
];
const GROUPS: GroupItem[] = [
  { kind: 'table', icon: 'table', labelKey: 'tree.tables' },
  { kind: 'sequence', icon: 'sequence', labelKey: 'tree.sequences' },
  { kind: 'dataType', icon: 'dataType', labelKey: 'tree.dataTypes' },
  { kind: 'view', icon: 'view', labelKey: 'tree.views' },
  { kind: 'index', icon: 'index', labelKey: 'tree.indexes' },
  { kind: 'trigger', icon: 'trigger', labelKey: 'tree.triggers' }
];

export const ObjectTree: React.FC<ObjectTreeProps> = ({ state }) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['sequence', 'dataType', 'view', 'index', 'trigger']));
  const [menu, setMenu] = useState<{ x: number; y: number; obj: ObjectInfo } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { objects, currentObject } = state;

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? objects.filter((o) => o.name.toLowerCase().includes(q)) : objects;
    const out: Record<GroupItem['kind'], ObjectInfo[]> = {
      table: [],
      view: [],
      index: [],
      trigger: [],
      sequence: [],
      dataType: []
    };
    for (const o of filtered) {
      if (o.type === 'sequence') {
        out.sequence.push(o);
      } else if (o.type === 'view') {
        out.view.push(o);
      } else if (o.type === 'index') {
        out.index.push(o);
      } else if (o.type === 'trigger') {
        out.trigger.push(o);
      } else if (o.type === 'dataType') {
        out.dataType.push(o);
      } else if (o.type === 'table') {
        if (o.name !== 'sqlite_sequence') out.table.push(o);
      }
    }
    if (q) {
      for (const item of DATA_TYPE_ITEMS) {
        if (item.name.toLowerCase().includes(q)) out.dataType.push(item);
      }
    } else {
      for (const item of DATA_TYPE_ITEMS) out.dataType.push(item);
    }
    return out;
  }, [objects, query]);

  const toggle = (kind: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const handleItemClick = (obj: ObjectInfo) => {
    state.selectObject(obj);
  };

  const handleContextMenu = (e: React.MouseEvent, obj: ObjectInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, obj });
  };

  const buildMenuItems = (obj: ObjectInfo): ContextMenuItem[] => {
    const isTable = obj.type === 'table';
    const isView = obj.type === 'view';
    const items: ContextMenuItem[] = [];
    if (isTable || isView) {
      items.push({
        label: t('menu.viewData'),
        icon: 'rows',
        onClick: () => state.selectTable(obj.name)
      });
    }
    if (isTable) {
      items.push({
        label: t('menu.viewSchema'),
        icon: 'columns',
        onClick: () => state.openStructure(obj.name)
      });
    }
    items.push({
      label: t('menu.genSelect'),
      icon: 'sql',
      onClick: () => state.generateSelect(obj),
      disabled: !isTable && !isView
    });
    if (isTable) {
      items.push({
        label: t('menu.exportTable'),
        icon: 'export',
        onClick: () => state.startExport('table')
      });
      items.push({
        label: t('menu.importTable'),
        icon: 'import',
        onClick: () => state.startImport(obj.name)
      });
    }
    items.push({ separator: true });
    items.push({
      label: t('menu.copyName'),
      icon: 'copy',
      onClick: () => void navigator.clipboard.writeText(obj.name)
    });
    items.push({ separator: true });
    items.push({
      label: t('menu.deleteObject'),
      icon: 'trash',
      danger: true,
      onClick: () => void state.deleteObject(obj)
    });
    return items;
  };

  const activeKey = currentObject ? `${currentObject.kind}:${currentObject.name}` : undefined;

  return (
    <aside className="object-tree" ref={containerRef}>
      <div className="tree-header">
        <div className="tree-header-row">
          <Input
            icon="search"
            placeholder={t('tree.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <ToolbarIconButton icon="plus" label={t('cmd.newTableDialog')} onClick={() => state.openNewTableDialog()} />
        </div>
      </div>
      <div className="tree-groups">
        {GROUPS.map((g) => {
          const list = grouped[g.kind];
          if (list.length === 0) return null;
          const isCollapsed = collapsed.has(g.kind);
          return (
            <div key={g.kind} className="tree-group">
              <div
                className="tree-group-header"
                onClick={() => toggle(g.kind)}
                role="button"
                aria-expanded={!isCollapsed}
              >
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={10} />
                <Icon name={g.icon} size={12} />
                <span className="tree-group-name">{t(g.labelKey)}</span>
                <span className="tree-group-count">({list.length})</span>
              </div>
              {!isCollapsed && (
                <div className="tree-group-items">
                  {list.map((obj) => (
                    <div
                      key={obj.type + ':' + obj.name}
                      className={'tree-item' + (activeKey === obj.type + ':' + obj.name ? ' tree-item-active' : '')}
                      onClick={() => handleItemClick(obj)}
                      onContextMenu={(e) => handleContextMenu(e, obj)}
                      title={obj.name}
                    >
                      <Icon name={g.icon} size={12} />
                      <span className="tree-item-name">{obj.name}</span>
                      {obj.type === 'sequence' && typeof obj.seq === 'number' && (
                        <Badge variant="pk">{obj.seq}</Badge>
                      )}
                      {obj.type === 'table' && obj.sql && (obj.sql.toUpperCase().includes('WITHOUT ROWID')) && (
                        <Badge variant="default">WR</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {objects.length === 0 && <div className="tree-empty">{t('tree.none')}</div>}
      </div>

      {menu && <ContextMenu open x={menu.x} y={menu.y} items={buildMenuItems(menu.obj)} onClose={() => setMenu(null)} />}
    </aside>
  );
};
