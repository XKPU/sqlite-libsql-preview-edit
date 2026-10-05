# SQLite/LibSQL/Turso P&E

![SQLite/LibSQL/Turso P&E](icons/sqlite-libsql-preview-edit-64.png)

[![Version](https://img.shields.io/github/v/release/XKPU/sqlite-libsql-preview-edit?logo=github)](https://github.com/XKPU/sqlite-libsql-preview-edit/releases/latest)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--only-green?logo=data:image/svg+xml;base64,PHN2ZyB0PSIxNzg2ODczMTA1MjgwIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjY2MzEiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDE2QzIzOC4wNjYgMTYgMTYgMjM4LjA2NiAxNiA1MTJzMjIyLjA2NiA0OTYgNDk2IDQ5NiA0OTYtMjIyLjA2NiA0OTYtNDk2Uzc4NS45MzQgMTYgNTEyIDE2eiBtMCA4OTZjLTIyMS4wNjQgMC00MDAtMTc4LjkwMi00MDAtNDAwIDAtMjIxLjA2MiAxNzguOTAyLTQwMCA0MDAtNDAwIDIyMS4wNjQgMCA0MDAgMTc4LjkwMiA0MDAgNDAwIDAgMjIxLjA2NC0xNzguOTAyIDQwMC00MDAgNDAweiBtMjE0LjcwMi0yMDIuMTI4Yy0xOS4yMjggMTkuNDI0LTkxLjA2IDgyLjc5Mi0yMDguMTMgODIuNzkyLTE2NC44NiAwLTI4MC45NjgtMTIyLjg1LTI4MC45NjgtMjgzLjEzNCAwLTE1OC4zMDQgMTIwLjU1LTI3OC44MDIgMjc5LjUyNC0yNzguODAyIDExMS4wNjIgMCAxNzcuNDc2IDUzLjI0IDE5NS4xODYgNjkuNTU4YTIzLjkzIDIzLjkzIDAgMCAxIDMuODcyIDMwLjY0NGwtMzYuMzEgNTYuMjI2Yy03LjY4MiAxMS45LTIzLjkzMiAxNC41NjQtMzQuOTk4IDUuODQyLTE3LjE5LTEzLjU1Mi02My42MjgtNDUuMDc2LTEyMy40MTYtNDUuMDc2LTk2LjYwNiAwLTE1NS44MzIgNzAuNjYtMTU1LjgzMiAxNjAuMTY0IDAgODMuMTc4IDUzLjc3NiAxNjcuMzg0IDE1Ni41NTQgMTY3LjM4NCA2NS4zMTQgMCAxMDMuNjg2LTM4LjA3OCAxMzEuNDUyLTU0LjQ1IDEwLjU0LTkuNzE0IDI3LjE5Mi04LjA3OCAzNS42NCAzLjQ3NmwzOS43MyA1NC4zNGEyMy44OTQgMjMuODk0IDAgMCAxLTIuMzA0IDMxLjAzNnoiIGZpbGw9IiNmZmZmZmYiIHAtaWQ9IjY2MzIiPjwvcGF0aD48L3N2Zz4=)](LICENSE)

[English](README.md) | [简体中文](README.zh-cn.md)

A VS Code extension for previewing and editing **SQLite / LibSQL / Turso** database files.

### Engine

The extension runs on the built-in **native Turso Database engine** (`@tursodatabase/database`, i.e., the Rust implementation of SQLite).
It directly opens local files and reads/writes the universal `SQLite format 3` container format, so the same editor can handle **SQLite, LibSQL, and Turso Database** files.

Only the following targets are supported:

- Windows x64
- macOS Apple silicon (`arm64`)
- Linux x64 and Linux `arm64` (glibc)

Intel macOS, Alpine/musl, and Windows `arm64` are **not supported**, because upstream has not released corresponding binaries.
If your platform is not in the list, the extension will be unable to load the engine.

### Support

- `.db` / `.sqlite` / `.sqlite3` / `.libsql` files
- Standard SQLite feature set
- Turso Database extras: sequences (`CREATE SEQUENCE` / `nextval()`), `STRICT`
  tables, `ALTER TABLE … ALTER COLUMN`, vector functions, non-constant defaults
- Automatic LibSQL / Turso detection
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

The extension writes to a dedicated VS Code Output channel named **SQLite/LibSQL/Turso P&E**.

- Open it via **Output → SQLite/LibSQL/Turso P&E**.
- Records both sides of the conversation: requests received by the host (`-> host received:`), responses sent (`<- host sending:`), webview-side diagnostics (`[webview] …`), and any unrecognised message.

### After installing a new build

Installing or upgrading the extension does not restart an already-open window's extension host. **Reload the window** (`Developer: Reload Window`) to finish updating. Until then the editor may report:

> Extension updated — reload the window to finish

## AI Disclosure

This project uses AI-assisted tools extensively in development, testing, documentation, and maintenance, mainly for code generation and documentation improvement.

All AI-generated or AI-suggested content is human-reviewed, verified, and adjusted as needed.

AI usage does not change this project's open-source license and third-party terms.

## License
```
SQLite/LibSQL/Turso P&E - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```