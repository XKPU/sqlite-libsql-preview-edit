# Changelog

## 0.0.1

Initial release. Published as **SQLite/LibSQL Preview&Edit**.

### Added

- Custom editor for `.db`, `.sqlite`, `.sqlite3`, `.libsql` files, opening in the normal editor group (no separate panel or window)
- SQLite as the default engine, with automatic LibSQL detection from the engine version string, LibSQL system objects, engine pragmas, and the file extension
- LibSQL-only capabilities (strict tables, `ALTER COLUMN`, vector search, `RETURNING` upserts, embedded replicas, non-constant defaults) enabled automatically once LibSQL is detected
- Theme inheritance: the webview uses only VS Code theme colors, so it follows light/dark/high-contrast themes
- Database info panel (path, size, page size, encoding, counts, engine, detection evidence, driver)
- Object tree with tables, views, indexes, triggers, and SQLite system metadata
- Data browser with pagination, sorting, column filtering, and row search
- Inline cell editing with staging, save, and rollback
- Add/delete/duplicate row operations
- Primary key detection with rowid fallback for keyless tables
- SQL editor with multi-statement execution and run-all/run-selection
- Read-only query result table with CSV/JSON export
- Structure view with column management (add, rename, delete) and index creation
- Import CSV/JSON with field mapping, type inference, and conflict handling
- Export table or whole database as CSV, JSON, or SQL
- Transactional writes with automatic rollback on failure
- Serialized persistence so overlapping writes cannot tear the database file
- Destructive-action confirmation dialog (configurable)
- Read-only mode setting
- Bilingual interface (English and Simplified Chinese) with live language switching
- Portable WASM backend (sql.js) with no native dependencies
- Dedicated VS Code Output channel for extension diagnostics, with `SQLite/LibSQL: Show Log` command
- Version-skew guard: the host and webview announce `PROTOCOL_VERSION`, so installing a new build while a window keeps its old extension host reports "reload the window" instead of failing
- Unknown or fire-and-forget messages are logged as warnings and never surfaced as fatal database errors

### Changed

- Consolidated duplicated code into shared primitives, so a fix has one home:
  - one `Modal` shell and `ModalActions` footer replace six hand-written dialog overlays
  - `ToolbarIconButton` replaces nineteen tooltip-wrapped icon buttons
  - `EmptyState`, `CheckboxLine`, `Field`, and `DialogError` replace the repeated panel, checkbox, label, and error markup
  - a single shared i18n module (`src/shared/i18n/`) replaces the host and webview copies, which defined the same 176 keys twice and had already drifted in their fallback behaviour
  - one shared `rowEditKey` replaces three byte-identical copies; one `valueToString` replaces two
  - the host's seventeen adapter-error guards fold into a single `answer` helper
- The dead-code check now also verifies that exported functions are actually called, not merely mentioned
- A duplication check joins `npm run verify`, so repeated logic cannot silently return
- The i18n *logic* is shared too, not just the tables: one `translate` carries the lookup, fallback, and placeholder rules for host and webview, so a missing key renders its own name on both sides (the webview previously rendered `undefined`)
- Four pass-through i18n re-export modules are gone; only the two table files remain, and a test fails if a table is declared anywhere else
