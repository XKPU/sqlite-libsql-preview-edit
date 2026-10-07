# SQLite/LibSQL/Turso Preview&Edit

## [Unreleased] - 2026-10-07

### Changed

- Switched to the native SQLite driver (`better-sqlite3`)\
  换用原生 SQLite 驱动（`better-sqlite3`）
- Stopped opening the database file exclusively via `locking_mode = exclusive`, now using `normal` instead\
  不再通过 `locking_mode = exclusive` 独占数据库文件，改用 `normal`
- Reduced the write lock wait from 5 s to 250 ms, so an unavailable lock now raises a clear error immediately instead of hanging\
  将写入锁等待从 5 秒缩短至 250 毫秒，抢不到锁时立即明确报错，而非长时间卡住
- Switched to `wal_checkpoint(PASSIVE)` when closing the database, avoiding lock contention with programs that share the file while clearing the WAL\
  关闭数据库时改用 `wal_checkpoint(PASSIVE)`，避免清空 WAL 时与共享该文件的程序争抢锁

### Fixed

- Fixed an issue where lock conflicts silently dropped writes\
  修复锁冲突时静默丢弃写入的问题

[Unreleased]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.4...HEAD