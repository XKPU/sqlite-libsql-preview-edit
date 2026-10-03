# SQLite/LibSQL Preview&Edit

![SQLite/LibSQL Preview&Edit](icons/sqlite-libsql-preview-edit-64.png)

[![版本](https://img.shields.io/github/v/release/XKPU/sqlite-libsql-preview-edit?logo=github)](https://github.com/XKPU/sqlite-libsql-preview-edit/releases/latest)
[![许可证: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-green)](LICENSE)

[English](README.md) | [简体中文](README.zh-cn.md)

A VS Code extension for previewing and editing **SQLite / LibSQL** database files.

### Support

- `.db` / `.sqlite` / `.sqlite3` / `.libsql` files
- Standard SQLite feature set
- Automatic LibSQL detection
- UI follows VS Code theme colors
- Data browser
- SQL statement editor
- Export `sql` / `csv` / `json`, import `csv` / `json`
- Read-only mode
- English and Simplified Chinese

## LibSQL detection

Defaults to `SQLite`; detection reads signals from strongest to weakest to detect `LibSQL`:

| Signal | Weight |
| --- | --- |
| Engine version string | 80 |
| LibSQL system tables | 75 |
| Engine pragmas | 70 |
| File extension | 60 |

Once LibSQL is detected, the extension enables the LibSQL capability set.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `libSqlPreviewEdit.language` | `auto` | `auto` (follow VS Code), `en`, or `zh-cn`. Changes apply live. |
| `libSqlPreviewEdit.pageSize` | `50` | Rows per page in the data browser. |
| `libSqlPreviewEdit.readOnly` | `false` | Disable all write operations. |
| `libSqlPreviewEdit.confirmDestructiveActions` | `true` | Ask before dropping tables, views, indexes, columns. |
| `libSqlPreviewEdit.nullDisplay` | `NULL` | Text shown for SQL NULL values. |
| `libSqlPreviewEdit.maxCellLength` | `1000` | Truncate cells longer than this. |
| `libSqlPreviewEdit.exportEncoding` | `utf8` | Encoding used for exports. |

## Diagnostics

The extension writes to a dedicated VS Code Output channel named **SQLite/LibSQL Preview&Edit**.

- Open it via **Output → SQLite/LibSQL Preview&Edit**.
- Records both sides of the conversation: requests received by the host (`-> host received:`), responses sent (`<- host sending:`), webview-side diagnostics (`[webview] …`), and any unrecognised message.

### After installing a new build

Installing or upgrading the extension does not restart an already-open window's extension host. **Reload the window** (`Developer: Reload Window`) to finish updating. Until then the editor may report:

> Extension updated — reload the window to finish

## License

AGPL-3.0-only
