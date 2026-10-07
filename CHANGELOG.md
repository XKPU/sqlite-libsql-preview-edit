# SQLite/LibSQL/Turso Preview&Edit

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

[v0.0.5]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.4...v0.0.5
