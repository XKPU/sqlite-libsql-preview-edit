// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * English messages — the single source of truth for every user-visible string.
 *
 * Both the extension host and the webview import this table, which is why it
 * lives under `src/shared/`: they need exactly the same strings, and keeping two
 * copies meant 176 keys were duplicated verbatim and free to drift. `MessageKey`
 * is derived here, so renaming a key breaks both consumers at compile time
 * rather than silently showing an untranslated string.
 */
export const en = {
  /* activation & commands */
  'cmd.open': 'Open libSQL / SQLite Database',
  'cmd.refresh': 'Refresh',
  'cmd.reopen': 'Re-open',
  'cmd.close': 'Close',
  'cmd.info': 'Database Info',
  'cmd.sqlEditor': 'Open SQL Editor',
  'cmd.addObject': 'Add Object',

  /* webview messages */
  'msg.loading': 'Loading database…',
  'msg.ready': 'Database opened',
  'msg.opened': 'Opened {path}',
  'msg.openFailed': 'Failed to open database',
  'msg.refreshed': 'Refreshed',
  'msg.closing': 'Closing…',
  'msg.closed': 'Database closed',
  'msg.cannotClose': 'Cannot close while edits are pending',
  'msg.settingsChanged': 'Settings updated',

  /* error messages */
  'err.notOpen': 'The database is not open.',
  'err.invalidFile': 'Invalid or unreadable database file',
  'err.emptyFile': 'The file is empty; a new database will be created.',
  'err.fileMissing': 'The file no longer exists',
  'err.cantWrite': 'The file is read-only or has no write permission',
  'err.sql': 'SQL error',
  'err.txFailed': 'Transaction failed and was rolled back',
  'err.confirmCancelled': 'Action cancelled',
  'err.noRows': 'No rows to operate on',
  'err.noSelection': 'No SQL is selected',
  'err.copyFailed': 'Could not copy to clipboard',
  'err.versionMismatch': 'Extension updated — reload the window to finish',
  'msg.copied': 'SQL copied to clipboard',
  'warn.readOnly': 'Editing is disabled in read-only mode',
  'warn.noSql': 'No SQL to execute.',
  'warn.selectOnly': 'A SELECT can only be generated for tables and views.',
  'warn.nothingToExport': 'There is nothing to export.',

  /* confirmations */
  'confirm.deleteTable.title': 'Delete table "{name}"?',
  'confirm.deleteTable.message': 'This will permanently remove the table and all of its data. This action cannot be undone.',
  'confirm.deleteView.title': 'Delete view "{name}"?',
  'confirm.deleteView.message': 'This will permanently remove the view definition. This action cannot be undone.',
  'confirm.deleteIndex.title': 'Delete index "{name}"?',
  'confirm.deleteIndex.message': 'This will permanently remove the index. This action cannot be undone.',
  'confirm.deleteTrigger.title': 'Delete trigger "{name}"?',
  'confirm.deleteTrigger.message': 'This will permanently remove the trigger definition. This action cannot be undone.',
  'confirm.deleteColumn.title': 'Delete column "{name}" from "{table}"?',
  'confirm.deleteColumn.message': 'SQLite drops and recreates the table to remove a column; all data in the column is lost.',
  'confirm.save': 'Save pending edits?',
  'confirm.save.message': 'You have unsaved edits. Save them now?',
  'confirm.rollback': 'Roll back edits?',
  'confirm.rollback.message': 'Discard all staged edits and revert to the last saved state?',

  /* info dialog */
  'info.title': 'Database Information',
  'info.path': 'File path',
  'info.size': 'File size',
  'info.pageSize': 'Page size',
  'info.encoding': 'Encoding',
  'info.tables': 'Tables',
  'info.views': 'Views',
  'info.indexes': 'Indexes',
  'info.triggers': 'Triggers',
  'info.writable': 'Writable',
  'info.version': 'SQLite version',
  'info.driver': 'Driver',
  'info.engine': 'Engine',

  /* engine detection */
  'engine.sqlite': 'SQLite',
  'engine.libsql': 'LibSQL',
  'engine.detected': 'Engine detected: {engine}',
  'engine.libsql.active': 'LibSQL features enabled',
  'engine.libsql.fallback': 'LibSQL file opened with the bundled SQLite engine',
  'engine.evidence': 'Detection evidence',

  /* LibSQL capabilities */
  'cap.title': 'LibSQL capabilities',
  'cap.strictTables': 'STRICT tables',
  'cap.alterColumn': 'ALTER / DROP COLUMN',
  'cap.vectorSearch': 'Vector search',
  'cap.upsertReturning': 'UPSERT … RETURNING',
  'cap.embeddedReplicas': 'Embedded replicas',
  'cap.nonConstantDefaults': 'Non-constant defaults',
  'cap.functions': 'LibSQL functions',
  'cap.enabled': 'enabled',
  'cap.disabled': 'not available',

  /* object tree */
  'tree.tables': 'Tables',
  'tree.views': 'Views',
  'tree.indexes': 'Indexes',
  'tree.triggers': 'Triggers',
  'tree.system': 'System / SQLite Metadata',
  'tree.search': 'Search objects…',
  'tree.none': 'No objects',

  /* context menu */
  'menu.viewData': 'View data',
  'menu.viewSchema': 'View structure',
  'menu.genSelect': 'Generate SELECT',
  'menu.exportTable': 'Export table',
  'menu.importTable': 'Import into table',
  'menu.deleteObject': 'Delete',
  'menu.copyName': 'Copy name',

  /* data table */
  'data.page': 'Page',
  'data.of': 'of',
  'data.prev': 'Previous',
  'data.next': 'Next',
  'data.rows': '{count} rows',
  'data.rows.total': '{count} rows total',
  'data.save': 'Save',
  'data.rollback': 'Roll back',
  'data.addRow': 'Add row',
  'data.deleteRow': 'Delete row',
  'data.restoreRow': 'Restore row',
  'data.actions': 'Row actions',
  'data.duplicateRow': 'Duplicate row',
  'data.newCell': 'New',
  'data.modified': 'Modified',
  'data.deleted': 'Deleted',
  'data.null': 'NULL',
  'data.search': 'Filter rows…',
  'data.columnFilter': 'Filter {column}',
  'data.sortAsc': 'Sort ascending',
  'data.sortDesc': 'Sort descending',
  'data.pk': 'PK',
  'data.noPk': 'This table has no primary key; edits use the implicit rowid.',
  'data.added': 'Row added (not yet saved)',
  'data.editDisabled': 'Edit is disabled in read-only mode',

  /* sql editor */
  'sql.editorTitle': 'SQL Editor',
  'sql.runAll': 'Run all',
  'sql.runSelection': 'Run selection',
  'sql.clear': 'Clear',
  'sql.format': 'Format',
  'sql.copy': 'Copy SQL',
  'sql.history': 'History',
  'sql.exportCsv': 'Export CSV',
  'sql.exportJson': 'Export JSON',
  'sql.copyResult': 'Copy result',
  'sql.rowsAffected': '{count} row(s) affected in {ms} ms',
  'sql.result': 'Result',
  'sql.error': 'SQL error',
  'sql.errorLine': 'Line {line}, column {col}',
  'sql.errorCopy': 'Copy error',
  'sql.execute': 'Execute',

  /* structure view */
  'struct.title': 'Structure',
  'struct.columns': 'Columns',
  'struct.name': 'Name',
  'struct.type': 'Type',
  'struct.notNull': 'NOT NULL',
  'struct.pk': 'PK',
  'struct.default': 'Default',
  'struct.createSql': 'CREATE statement',
  'struct.addColumn': 'Add column',
  'struct.renameColumn': 'Rename column',
  'struct.deleteColumn': 'Delete column',
  'struct.createIndex': 'Create index',
  'struct.deleteIndex': 'Delete index',
  'struct.columnName': 'Column name',
  'struct.columnType': 'Column type',
  'struct.notNullField': 'NOT NULL',
  'struct.defaultValue': 'Default value',
  'struct.primaryKey': 'Primary key',
  'struct.apply': 'Apply',
  'struct.cancel': 'Cancel',

  /* export */
  'export.title': 'Export',
  'export.database': 'Whole database',
  'export.table': 'Current table',
  'export.format': 'Format',
  'export.csv': 'CSV',
  'export.json': 'JSON',
  'export.sql': 'SQL',
  'export.choosePath': 'Choose destination',
  'export.scope': 'Scope',
  'export.pathHint': 'The host will prompt for the destination directory.',
  'export.exporting': 'Exporting…',
  'export.done': 'Exported {path}',
  'export.encoding': 'Encoding',

  /* import */
  'import.title': 'Import',
  'import.tableName': 'Target table',
  'import.tableNamePlaceholder': 'target_table',
  'import.file': 'File',
  'import.filePlaceholder': '/path/to/file.csv',
  'import.createNew': 'Create table if it does not exist',
  'import.conflict': 'On conflict',
  'import.conflictSkip': 'Skip duplicates',
  'import.conflictReplace': 'Replace duplicates',
  'import.conflictFail': 'Stop on first conflict',
  'import.field': 'Source field',
  'import.target': 'Target column',
  'import.type': 'Detected type',
  'import.preview': 'Preview',
  'import.importing': 'Importing…',
  'import.done': 'Imported {count} rows, skipped {skipped}',
  'import.cancel': 'Cancel import',
  'import.sampleRows': 'Sample rows',
  'import.skipField': '— skip —',
  'struct.columnNamePlaceholder': 'column_name',
  'struct.defaultPlaceholder': 'NULL',
  'struct.indexNamePlaceholder': 'idx_name',
  'struct.typeNone': '— none —',

  /* language */
  'language': 'Language',
  'language.en': 'English',
  'language.zh-cn': 'Chinese (Simplified)',

  /* status */
  'status.readOnly': 'Read-only',
  'status.writable': 'Writable',
  'status.opened': 'Opened',
  'status.closed': 'Closed',
  'status.editing': '{count} unsaved edit(s)',

  /* progress */
  'progress.opening': 'Opening database…',
  'progress.refreshing': 'Refreshing…',
  'progress.importing': 'Importing…',
  'progress.exporting': 'Exporting…',
  'progress.executing': 'Executing…',

  /* misc */
  'yes': 'Yes',
  'no': 'No',
  'ok': 'OK',
  'cancel': 'Cancel',
  'save': 'Save',
  'discard': 'Discard',
  'apply': 'Apply',
  'close': 'Close',
  'confirm': 'Confirm',
  'loading': 'Loading…',
  'unknown': 'Unknown',
  'empty': '—'
} as const;

export type EnglishMessages = typeof en;
export type MessageKey = keyof EnglishMessages;
