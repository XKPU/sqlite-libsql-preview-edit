# SQLite/LibSQL/Turso Preview&Edit

## [Unreleased]

---

## [v0.0.5] - 2026-10-07

### Changed

- Switched to the native SQLite driver (`better-sqlite3`)\
  换用原生 SQLite 驱动（`better-sqlite3`）
- The engine no longer opens the database in exclusive locking mode (`normal` instead), so other processes can read and write while it is open, even in WAL mode\
  引擎不再以独占锁模式打开数据库（改用 `normal`），因此打开期间其他进程也能读写，WAL 模式亦然
- Reduced the write lock wait from 5 s to 250 ms, so an unavailable lock now raises a clear error immediately instead of hanging\
  将写入锁等待从 5 秒缩短至 250 毫秒，抢不到锁时立即明确报错，而非长时间卡住
- Switched to `wal_checkpoint(PASSIVE)` when closing the database, avoiding lock contention with programs that share the file while clearing the WAL\
  关闭数据库时改用 `wal_checkpoint(PASSIVE)`，避免清空 WAL 时与共享该文件的程序争抢锁

### Fixed

- Fixed an issue where lock conflicts silently dropped writes\
  修复锁冲突时静默丢弃写入的问题

---

## [v0.0.4] - 2026-10-06

### Added

- Added automatic fallback to read-only mode when a file is locked, with a yellow notice shown at the bottom of the sidebar\
  在文件被锁定时自动降级为只读模式，并在左侧边栏下方显示黄色提示

### Security

- Addressed dependency security alerts\
  处理依赖安全警报
  - Removed `linkify-it` (required ≥5.0.2)\
    已移除 `linkify-it`（要求 ≥5.0.2）
  - Removed `markdown-it` (required ≥14.3.1)\
    已移除 `markdown-it`（要求 ≥14.3.1）
  - Removed `xml2js` (required ≥0.5.0)\
    已移除 `xml2js`（要求 ≥0.5.0）
  - Bumped `vite` to 6.4.3 (required ≥6.4.3)\
    将 `vite` 升级至 6.4.3（要求 ≥6.4.3）
  - Bumped `esbuild` to 0.25.12 (required ≥0.25.0)\
    将 `esbuild` 升级至 0.25.12（要求 ≥0.25.0）
- Fixed the CodeQL alert "Shell command built from environment values" in `scripts/test-runner.js`\
  修复 `scripts/test-runner.js` 中的 CodeQL“Shell command built from environment values”警报
  - Line 19 — `execSync(\`node ${JSON.stringify(tscPath)} -p ./tsconfig.test.json\`)`
  - Line 49 — `execSync(\`node --test ${JSON.stringify(file)}\`)`
  - Line 61 — `execSync(\`node ${JSON.stringify(path.join(__dirname, 'verify-message-router.js'))}\`)`

---

## [v0.0.3] - 2026-10-05

### Added

- Added a "Data Types" category to the sidebar for inspecting the current database's data types\
  左侧栏新增“数据类型”分类，可查看当前数据库的数据类型
- Added a "Sequences" category to the sidebar\
  左侧栏新增“序列”分类
- Added support for specifying the sequence value when an auto-increment column is first created in a new table on Turso (LibSQL) databases\
  在 Turso (LibSQL) 数据库中创建新表并首次建立自增列时，支持指定序列值
- Added a "Save As" dialog on export so the destination can be chosen freely\
  导出时弹出“另存为”对话框，可自由选择保存位置

### Changed

- Moved the sqlite_sequence table under the Sequences category
  将 sqlite_sequence 表移至序列分类下
- Reworked the sqlite_sequence view so each table's sequence appears as a separate entry under the Sequences category instead of being aggregated into the sqlite_sequence table
  重构 sqlite_sequence 展示方式，各表的序列以独立条目显示在序列分类下，不再集中显示于 sqlite_sequence 表中
- Redesigned the sequence view to show each sequence's name, value, minimum, maximum, and increment, all read-only
  重新设计序列展示，呈现每条序列的名称、数值、最小值、最大值与增量，全部只读
- Replaced `@libsql/client` with Turso Database (`@tursodatabase/database`)
  将 `@libsql/client` 替换为 Turso Database（`@tursodatabase/database`）
- Updated the extension's display name to SQLite/LibSQL/Turso P&E; internal identifiers such as the package name, command IDs, and custom editor view types remain unchanged
  扩展显示名变更为 SQLite/LibSQL/Turso P&E，包名、命令 ID、自定义编辑器视图类型等内部标识保持不变

### Fixed

- Fixed an issue where exported files were always written to the system temp directory, preventing users from choosing their own destination\
  修复导出文件始终写入系统临时目录、用户无法自行选择保存路径的问题
- Fixed an issue where exporting from a custom SQL query always failed\
  修复通过自定义 SQL 查询导出时始终失败的问题

---

## [v0.0.2] - 2026-10-03

### Fixed
- Fixed an issue where the initialization process hangs\
  修复初始化过程卡死的问题 
### Changed 
- Removed sql.js; the project now uses `@libsql/client` \
  exclusively 移除 sql.js，改为仅使用 `@libsql/client`

---

## [v0.0.1] - 2026-10-03

[Unreleased]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.5...HEAD

[v0.0.5]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.4...v0.0.5
[v0.0.4]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.3...v0.0.4
[v0.0.3]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.2...v0.0.3
[v0.0.2]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.1...v0.0.2
[v0.0.1]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/07f87505764ce6fc494525e90fd926aea0a21728...v0.0.1
