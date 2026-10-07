<!--
SPDX-FileCopyrightText: 2026 K_PU
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Support

This is the primary support document. For Simplified Chinese, see the [中文支持文档](SUPPORT.zh-cn.md).

For general information about the extension, see the [README](README.md).

## Contents

- [Before you ask](#before-you-ask)
- [Bugs and suggestions](#bugs-and-suggestions)
- [Out of scope](#out-of-scope)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Before you ask

The following covers the most common issues.

### The extension will not load on my platform

Only four architectures are supported. See [Driver](README.md#driver) in the README.

| OS | Architecture |
| --- | --- |
| Windows | x64 |
| macOS | Apple silicon (`arm64`) |
| Linux | x64, `arm64` (glibc) |

macOS Intel, Alpine/musl, and Windows `arm64` are not supported. The bundled engine does ship binaries for them, but the extension has never advertised or tested those platforms, so no VSIX is built for them.

### A lock conflict: "database is locked"

The engine is stock SQLite in **normal** locking mode, so it cooperates with other processes rather than fencing them off: a program that has the database open can keep reading and writing while the extension holds it open, in WAL and rollback-journal mode alike. (The previous engine opened files in `locking_mode = exclusive`, which blocked every other process even in WAL — that is fixed.)

If another program is mid-transaction, the extension waits only briefly (250 ms) for the lock, then fails with a clear `database is locked` error rather than reporting a success that did not happen. A longer wait does not help: a service that holds a transaction open indefinitely produces the same error whatever the budget, so a short one only spares you the freeze. Retry once the other process finishes. Read-only mode (`libSqlPreviewEdit.readOnly`) avoids taking write locks altogether.

### "Extension updated — reload the window to finish"

Installing or upgrading does not restart a window that is already open. Run **Developer: Reload Window** and the message goes away.

### The reported dialect looks wrong

`.db`, `.sqlite`, `.sqlite3`, `.libsql`, and `.turso` are all supported. The **driver** is always the bundled native SQLite engine (`better-sqlite3`); the **dialect** reports what the file contains, not which implementation is loaded. See [Driver vs dialect](README.md#driver-vs-dialect).

### Something failed and I need details

Open the Output channel **SQLite/LibSQL/Turso P&E** (View → Output). It records both directions of every webview/host message, including errors.

## Bugs and suggestions

Bug reports, feature requests, and usage questions all go to the same issue tracker: <https://github.com/XKPU/sqlite-libsql-preview-edit/issues>

- **A bug** — describe the defect.
- **A feature** — describe what you need.
- **Help** — describe what you are stuck on.
- **Unclassified** — acceptable; no category is required.

### A useful bug report usually contains

1. **What you did** — the steps that led to the problem.
2. **What you expected** and **what happened instead**.
3. **Your environment** — OS and architecture, VS Code version, extension version.
4. **The Output channel log**, if the problem is runtime behaviour. Copy the relevant lines; the log is verbose, so trim to the failing operation.
5. **A minimal database file**, if the bug depends on specific data. Any small `.db` with the offending schema is enough.

You may instead **describe the feature that failed**, or say which items you cannot provide.

> **Please do not attach a database containing personal or confidential data.**

## Out of scope

- **Network databases.** The extension is a local-file viewer and editor. It does not connect to any remote server.
- **Unsupported architectures.** See [the table above](#the-extension-will-not-load-on-my-platform).
- **Embedded replicas.** That is a Turso Cloud feature, so it is reported as unavailable.

## Security

Please do **not** open a public issue for a security problem. Report it privately
through either channel:

- The GitHub
  [security advisory](https://github.com/XKPU/sqlite-libsql-preview-edit/security/advisories/new)
  form
- Email: `csaxongmail@gmail.com` or `u-eptm@u-eptm.top`

For more details, see [SECURITY](SECURITY.md).

## Contributing

Contributions are welcome.

Before submitting, **try to** run the local checks first, so reviewers can focus on the changes themselves.

Submissions that **have not run tests or contain only half-finished code and ideas** are also acceptable—please state that they are untested when submitting.

## License

```
SQLite/LibSQL/Turso P&E - VS Code extension for SQLite/LibSQL database preview and editing.  
Copyright (C) 2026  K_PU

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.
```
