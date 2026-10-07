<!--
SPDX-FileCopyrightText: 2026 K_PU
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# SQLite/LibSQL/Turso P&E

![SQLite/LibSQL/Turso P&E](icons/sqlite-libsql-preview-edit-64.png)

[![Version](https://img.shields.io/github/v/release/XKPU/sqlite-libsql-preview-edit?logo=github)](https://github.com/XKPU/sqlite-libsql-preview-edit/releases/latest)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--only-green?logo=data:image/svg+xml;base64,PHN2ZyB0PSIxNzg2ODczMTA1MjgwIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjY2MzEiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDE2QzIzOC4wNjYgMTYgMTYgMjM4LjA2NiAxNiA1MTJzMjIyLjA2NiA0OTYgNDk2IDQ5NiA0OTYtMjIyLjA2NiA0OTYtNDk2Uzc4NS45MzQgMTYgNTEyIDE2eiBtMCA4OTZjLTIyMS4wNjQgMC00MDAtMTc4LjkwMi00MDAtNDAwIDAtMjIxLjA2MiAxNzguOTAyLTQwMCA0MDAtNDAwIDIyMS4wNjQgMCA0MDAgMTc4LjkwMiA0MDAgNDAwIDAgMjIxLjA2NC0xNzguOTAyIDQwMC00MDAgNDAweiBtMjE0LjcwMi0yMDIuMTI4Yy0xOS4yMjggMTkuNDI0LTkxLjA2IDgyLjc5Mi0yMDguMTMgODIuNzkyLTE2NC44NiAwLTI4MC45NjgtMTIyLjg1LTI4MC45NjgtMjgzLjEzNCAwLTE1OC4zMDQgMTIwLjU1LTI3OC44MDIgMjc5LjUyNC0yNzguODAyIDExMS4wNjIgMCAxNzcuNDc2IDUzLjI0IDE5NS4xODYgNjkuNTU4YTIzLjkzIDIzLjkzIDAgMCAxIDMuODcyIDMwLjY0NGwtMzYuMzEgNTYuMjI2Yy03LjY4MiAxMS45LTIzLjkzMiAxNC41NjQtMzQuOTk4IDUuODQyLTE3LjE5LTEzLjU1Mi02My42MjgtNDUuMDc2LTEyMy40MTYtNDUuMDc2LTk2LjYwNiAwLTE1NS44MzIgNzAuNjYtMTU1LjgzMiAxNjAuMTY0IDAgODMuMTc4IDUzLjc3NiAxNjcuMzg0IDE1Ni41NTQgMTY3LjM4NCA2NS4zMTQgMCAxMDMuNjg2LTM4LjA3OCAxMzEuNDUyLTU0LjQ1IDEwLjU0LTkuNzE0IDI3LjE5Mi04LjA3OCAzNS42NCAzLjQ3NmwzOS43MyA1NC4zNGEyMy44OTQgMjMuODk0IDAgMCAxLTIuMzA0IDMxLjAzNnoiIGZpbGw9IiNmZmZmZmYiIHAtaWQ9IjY2MzIiPjwvcGF0aD48L3N2Zz4=)](LICENSE)

[English](README.md) | [简体中文](README.zh-cn.md)

A VS Code extension for previewing and editing **SQLite / LibSQL / Turso** database files.

> [!WARNING]
> **Early development.** This project is at an early stage: it still has a fair number of rough edges, and its behaviour and configuration may change frequently. Please weigh that before relying on it.

## Contents

- [Driver](#driver)
- [Features](#features)
- [Supported databases](#supported-databases)
- [Settings](#settings)
- [Diagnostics](#diagnostics)
- [AI Disclosure](#ai-disclosure)
- [Support](#support)
- [License](#license)

## Driver

The extension runs on the built-in **native Turso Database driver** (`@tursodatabase/database`, i.e., the Rust implementation of SQLite).
It directly opens local files and reads/writes the universal `SQLite format 3` container format, so the same editor can handle **SQLite, LibSQL, and Turso Database** files.

This is the only driver, and it is used for every file. See [Driver vs dialect](#driver-vs-dialect) for how the label differs from the driver.

Supported architectures:

| OS | Architecture |
| --- | --- |
| Windows | x64 |
| macOS | Apple silicon (`arm64`) |
| Linux | x64, `arm64` (glibc) |

macOS Intel, Alpine/musl, and Windows `arm64` are **not supported**.
If your platform is not listed, the extension cannot load the driver, and no database can be opened.

## Features

- `.db` / `.sqlite` / `.sqlite3` / `.libsql` / `.turso` files (see [Supported databases](#supported-databases))
- Standard SQLite feature set
- Turso Database extras: sequences (`CREATE SEQUENCE` / `nextval()`), `STRICT` tables, `ALTER TABLE … ALTER COLUMN`, vector functions, non-constant defaults
- Automatic dialect detection (SQLite, LibSQL, or Turso Database)
- UI follows VS Code theme colors
- Data browser
- SQL statement editor
- Export `sql` / `csv` / `json`, import `csv` / `json`
- Read-only mode
- English and Simplified Chinese

## Supported databases

Three file types are supported, and they share a single on-disk container
(`SQLite format 3`):

| Type | Typical extension | How it is recognised |
| --- | --- | --- |
| SQLite | `.db` `.sqlite` `.sqlite3` | the default when nothing else matches |
| LibSQL | `.libsql` | extension, version string, `libsql_*` tables, or pragmas |
| Turso Database | `.turso` | extension or version string |

Because the container is shared, **all three open directly — recognition never decides whether a file can be opened.** It determines only the reported dialect.

### Driver vs dialect

The info panel reports two independent values.

**Driver** — the implementation that executes queries. Its value is always `turso`: Turso Database is the only bundled driver and there is no fallback.

**Dialect** — the SQL dialect the file is written in, inferred from the file itself. Its value is `SQLite`, `LibSQL`, or `Turso Database`.

The dialect is reported for information only. It does not select the driver, enable or disable any capability, or affect how a statement is executed; every file is handled by the same driver with the same feature set. A `.db` file is reported as `SQLite` because that describes the file's content, and it supports everything a `.turso` file does.

The info panel row labelled **Engine** shows the dialect value.

### Detection

The strongest single signal decides; weights are never summed, so one
conclusive marker is enough and a stray hint cannot outvote it.

| Signal | Weight |
| --- | --- |
| Version string (Turso identifier) | 80 |
| Version string (LibSQL identifier) | 80 |
| LibSQL system tables | 75 |
| Engine pragmas | 70 |
| File extension (`.libsql` / `.turso`) | 60 |

A Turso version string is tested before the LibSQL one, because the LibSQL
pattern also matches `turso` and would otherwise mislabel it.

When no signal matches, the file is treated as plain SQLite. The verdict is
shown in the database info panel together with the evidence that decided it.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `libSqlPreviewEdit.language` | `auto` | `auto` (follow VS Code), `en`, or `zh-cn`. Changes apply live. |
| `libSqlPreviewEdit.pageSize` | `50` | Rows per page in the data browser. |
| `libSqlPreviewEdit.readOnly` | `false` | Disable all write operations. |
| `libSqlPreviewEdit.readOnlyTables` | `[]` | Tables treated as read-only even when the global write switch is enabled. |
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

## Support

Getting help, reporting bugs, and what is out of scope: **[SUPPORT.md](SUPPORT.md)**
([简体中文](SUPPORT.zh-cn.md)).

Reporting a security vulnerability: **[SECURITY.md](SECURITY.md)** ([简体中文](SECURITY.zh-cn.md)).

## License
```
SQLite/LibSQL/Turso P&E - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```