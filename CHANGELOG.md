# SQLite/LibSQL/Turso Preview&Edit

## [v0.0.6]

### Added

- Enforced `readOnly` setting at the connection level — when enabled, SQLite opens the database with the `readonly` flag, so the engine itself blocks any write attempt at the lowest level\
  连接层强制 `readOnly` 设置 — 启用时 SQLite 以 `readonly` 标志打开数据库，引擎本身在最低层阻止任何写入企图
- Enforced `readOnlyTables` setting at the message-routing level — write operations targeting protected tables are rejected before reaching the adapter; for free-form SQL from the editor, the connection-level read-only flag serves as the hard guarantee\
  消息路由层强制 `readOnlyTables` 设置 — 针对受保护表的写入操作在进入适配器前即被拒绝；编辑器自由 SQL 则由连接级只读标志作为硬保证
- Enforced `readOnly` for all write messages (`commitEdits`, `insertRow`, `deleteRows`, `executeStatements`, `importCommit`, `executeDdl`, `deleteObject`) at the adapter level via a unified guard, returning a clear permission error instead of a raw `SQLITE_READONLY`\
  适配器层通过统一守卫对所有写消息实施 `readOnly` 检查，返回明确的权限错误而非原始 `SQLITE_READONLY`

### Fixed

- Fixed an issue where `deleteRows` with an empty primary key silently deleted the entire table — it now returns a clear error\
  修复 `deleteRows` 在空主键时静默删除整张表的问题 — 现返回明确错误
- Fixed SQL injection via filter and search in the webview — filter values and search terms are now sent as bound parameters rather than interpolated into the SQL string\
  修复 Webview 中过滤和搜索的 SQL 注入 — 过滤值与搜索词现以绑定参数发送，不再拼接入 SQL 字符串
- Fixed `LIKE` escape declarations — `ESCAPE '\'` is now properly declared so that escaped wildcards (`\%`, `\_`) are treated literally\
  修复 `LIKE` 转义声明 — 现正确声明 `ESCAPE '\'`，使转义后的通配符（`\%`、`\_`）按字面量处理
- Fixed `query()` failing on statements with multiple trailing semicolons (e.g. `SELECT 1;;`)\
  修复 `query()` 在多个尾随分号时失败的问题（如 `SELECT 1;;`）
- Rewrote the SQL export pipeline — exports now wrap in a transaction with proper object ordering (tables → views → indexes → triggers), preserve `sqlite_sequence` rows as `UPDATE` statements, and exclude FTS shadow tables from both SQL and JSON exports\
  重写 SQL 导出流程 — 导出以事务包裹并按正确顺序排列对象（表 → 视图 → 索引 → 触发器），将 `sqlite_sequence` 保留为 `UPDATE` 语句，并在 SQL/JSON 双导出中排除 FTS 阴影表
- Fixed `open` and `openSettings` messages never receiving a response, which caused the webview to hang for the full 120-second timeout\
  修复 `open` 和 `openSettings` 消息永不回包导致 Webview 挂满 120 秒超时的问题
- Fixed the import file picker — replaced `window.prompt` (always `null` in webviews) with a native `showOpenDialog` through a new `pickImportFile` protocol message\
  修复导入选文件 — 将 `window.prompt`（在 Webview 中恒为 `null`）替换为通过新协议消息 `pickImportFile` 调起的原生 `showOpenDialog`
- Fixed the import preview dialog being cleared on every re-render by switching its effect to a ref-based state pattern\
  修复导入预览对话框每次重渲染都被清空 — effect 改用 ref 状态模式，依赖仅剩 `[open]`
- Fixed the "Close Database" command referencing the non-existent `vscode.close` — now uses `workbench.action.closeActiveEditor`\
  修复“关闭数据库”命令引用了不存在的 `vscode.close` — 现改用 `workbench.action.closeActiveEditor`
- Fixed six write entry points (`insertRow`, `deleteRows`, `duplicateRow`, `executeStatements`, `deleteObject`, `importCommit`) bypassing the mutex, which could cause nested transactions under concurrent messages — all now wrapped in `mutex.run`\
  修复 6 个写入口绕过互斥锁导致并发消息可嵌套事务 — 现全部包入 `mutex.run`
- Fixed the SQL editor silently truncating results at 1,000 rows — the limit is now 10,000, with a `truncated` flag reported to the UI\
  修复 SQL 编辑器静默截断 1,000 行结果 — 上限提升至 10,000，并上报 `truncated` 标记
- Fixed `commitEdits` reporting incorrect change counts by accumulating the actual `changes` from each `UPDATE` statement\
  修复 `commitEdits` 计数错误 — 按每条 `UPDATE` 的实际 `changes` 累计
- Fixed `WITHOUT ROWID` tables returning a fake primary key (the rowid) after insert — the real primary key columns are now re-read after insertion\
  修复 `WITHOUT ROWID` 表插入后返回假主键（rowid）— 现插入后回读真实主键列
- Fixed the "Add Column" dialog concatenating the `DEFAULT` value directly into the SQL string — it now goes through `quoteLiteral` (except for `NULL`/`CURRENT_*` keywords)\
  修复“加列”对话框将 `DEFAULT` 值裸拼接入 SQL — 现经 `quoteLiteral` 处理（`NULL`/`CURRENT_*` 关键字除外）
- Fixed the "Copy Row" button always copying row 0 regardless of which cell is being edited\
  修复“复制行”按钮永远复制第 0 行而非当前编辑行
- Fixed the column filter dropdown offering useless options and containing a dead expression (`disabled={readOnly ? false : false}`)\
  修复列过滤器下拉选项无用且包含恒等死表达式
- Fixed `true`/`false` input producing JavaScript booleans the engine rejects — now converted to `1`/`0`\
  修复 `true`/`false` 输入产生引擎拒绝绑定的布尔值 — 现转为 `1`/`0`
- Fixed `normalizeValue` silently dropping `byteOffset`/`byteLength` when wrapping `ArrayBuffer` views\
  修复 `normalizeValue` 包装 `ArrayBuffer` 视图时丢弃 `byteOffset`/`byteLength`
- Fixed the per-request 120-second timeout timer never being cleared after the response arrived\
  修复每个请求的 120 秒超时定时器回包后永不清理
- Fixed the import format being determined by file extension instead of the user's explicit format selection — `importCommit` now carries a `format` parameter\
  修复导入格式取文件扩展名而非用户显式选择 — `importCommit` 现携带 `format` 参数
- Fixed export and import dialogs using the wrong panel's working directory — they are now panel-aware and prefer the sender panel's document directory\
  修复导出/导入对话框用错面板的工作目录 — 现感知所属面板，优先使用发送方面板的文档目录
- Fixed `getObjects` failures silently producing an empty tree — errors are now reported to the webview so the problem is visible instead of appearing as an empty database\
  修复 `getObjects` 失败时静默展示空树 — 错误现上报至 Webview，不再误显为“空库”
- Replaced `Math.random`-based nonce generation with `crypto.randomBytes` plus rejection sampling to eliminate modulo bias in the webview HTML CSP nonce\
  将 Webview HTML CSP nonce 生成从 `Math.random` 替换为 `crypto.randomBytes` + 拒绝采样，消除模偏差
- Simplified `quoteLiteral` by removing a dead ternary in the numeric branch (the expression always took the same path)\
  简化 `quoteLiteral`，移除数字分支中的死三元表达式
- Fixed `rowEditKey` collisions — `null` and the string `"null"` previously produced the same key; now uses length-prefix encoding with a `\u0000null` tag\
  修复 `rowEditKey` 冲突 — `null` 与字符串 `"null"` 此前生成相同 key，现改用长度前缀编码 + `\u0000null` 标签
- Removed dead protocol fields (`progress`/`readOnly` in responses, `orderBy?`/`where?` in query requests) from both the shared protocol and webview handler\
  从共享协议和 Webview handler 中移除死字段（响应中的 `progress`/`readOnly`、query 请求中的 `orderBy?`/`where?`）
- Aligned `@types/vscode` to `^1.101.0` to match the `engines` field, resolving the type version mismatch\
  将 `@types/vscode` 对齐至 `^1.101.0` 以匹配 `engines` 字段，解决类型版本不匹配
- Fixed all-empty columns being inferred as `INTEGER` — they are now inferred as `TEXT`; also fixed CSV BLOB literals (`X'hex'`) missing quotes so they now round-trip correctly\
  修复全空列被推断为 `INTEGER` — 现推断为 `TEXT`；同时修复 CSV BLOB 字面量（`X'hex'`）缺引号，现可正确往返
- Added `.db3` and `.turso` to the file-search glob, dialog filters, and `package.json` selector so these extensions are recognized when opening databases\
  在文件搜索 glob、对话框过滤器和 `package.json` 选择器中补全 `.db3` 和 `.turso` 扩展名
- Fixed the SQL editor sending an unnecessary `refreshRequested` message on open — now only sends `showSql`\
  修复打开 SQL 编辑器时额外发送 `refreshRequested` 消息 — 现仅发送 `showSql`
- Added `clampInt()` to the settings module so `pageSize` (1–10,000) and `maxCellLength` (1–1M) are clamped to valid ranges, and `NaN`/non-numeric values fall back to defaults instead of silently accepting garbage\
  在设置模块中新增 `clampInt()`，将 `pageSize`（1–10,000）和 `maxCellLength`（1–1M）钳制到有效范围，`NaN`/非数字值回退默认值，不再静默接受无效输入

### Changed

- Replaced the `better-sqlite3` native driver with `libsql` (the libSQL C fork of SQLite, as an npm module) — the only runtime engine, with no fallback. LibSQL/Turso files gain working `vector_*` functions; the driver value now reports `libsql`\
  将 `better-sqlite3` 原生驱动替换为 `libsql`（SQLite 的 libSQL C 分支，npm 模块）—— 唯一运行时引擎，无回退。LibSQL/Turso 文件获得可用的 `vector_*` 函数；driver 值现报告为 `libsql`
- Rewrote per-platform packaging for the libsql driver: one VSIX per target (`win32-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`), each carrying exactly one `@libsql/<target>` engine binary; `scripts/package-target.js` prunes sibling binaries, `scripts/verify-vsix.js` enforces the one-binary layout, and `scripts/smoke-native.js` loads the compiled adapter against the real binary\
  针对 libsql 驱动重写分平台打包：每个目标一个 VSIX（`win32-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`），各自恰好携带一个 `@libsql/<target>` 引擎二进制；`scripts/package-target.js` 负责裁剪同级二进制，`scripts/verify-vsix.js` 强制单二进制布局，`scripts/smoke-native.js` 用真实二进制加载编译后的适配器
- Rewrote the release workflow for the same targets with an engine-binary precheck and VSIX verification on each runner; macOS Intel (`darwin-x64`) is deliberately not packaged — SUPPORT.md now includes a self-packaging tutorial\
  重写发布工作流（相同目标平台），每个 runner 增加引擎二进制预检与 VSIX 校验；macOS Intel（`darwin-x64`）明确不打包 —— SUPPORT.md 新增自行打包教程
- Updated the `clearCache` command to honestly report how many read-only table protections were removed (and show a notice even when the list is already empty), with bilingual i18n keys\
  更新 `clearCache` 命令如实提示移除了几个受保护表（空列表时同样提示），双语 i18n 键已补齐

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

[Unreleased]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.6...HEAD

[v0.0.6]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.5...v0.0.6
[v0.0.5]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.4...v0.0.5
[v0.0.4]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.3...v0.0.4
[v0.0.3]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.2...v0.0.3
[v0.0.2]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/v0.0.1...v0.0.2
[v0.0.1]: https://github.com/XKPU/sqlite-libsql-preview-edit/compare/07f87505764ce6fc494525e90fd926aea0a21728...v0.0.1