# SQLite/LibSQL/Turso Preview&Edit

## [Unreleased] - 2026-10-05

### Added

- Added a "Data Types" category to the sidebar for inspecting the current database's data types
  左侧栏新增“数据类型”分类，可查看当前数据库的数据类型
- Added a "Sequences" category to the sidebar
  左侧栏新增“序列”分类
- Added support for specifying the sequence value when an auto-increment column is first created in a new table on Turso (LibSQL) databases
  在 Turso (LibSQL) 数据库中创建新表并首次建立自增列时，支持指定序列值
- Added a "Save As" dialog on export so the destination can be chosen freely
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

- Fixed an issue where exported files were always written to the system temp directory, preventing users from choosing their own destination
  修复导出文件始终写入系统临时目录、用户无法自行选择保存路径的问题
- Fixed an issue where exporting from a custom SQL query always failed
  修复通过自定义 SQL 查询导出时始终失败的问题

[Unreleased]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.2...HEAD