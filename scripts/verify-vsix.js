/**
 * Clean-room verification of the packaged VSIX.
 *
 * Extracts the `.vsix` into a throwaway directory and runs the bundled
 * extension code from there. The point is to prove the *shipped artifact* is
 * self-contained: nothing may resolve `sql.js` from the development
 * `node_modules`, because that directory does not exist on a user's machine.
 *
 * Checks:
 *   1. the archive carries no `node_modules` beyond the two runtime packages
 *      that `.vscodeignore` deliberately re-includes (`@libsql/**`, `libsql/**`,
 *      required by `require('@libsql/client')` at runtime) and no stray files
 *   2. `require.resolve('sql.js')` fails from inside the extraction
 *   3. the vendored adapter opens, creates, writes, reads, and closes a DB
 *   4. the on-disk file carries a real SQLite header
 *   5. a corrupt file is classified as DB_CORRUPT rather than UNKNOWN
 *
 * Run: node scripts/verify-vsix.js
 */
'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);

if (!fs.existsSync(vsix)) {
  console.error(`VSIX not found: ${vsix}\nRun "npm run package" first.`);
  process.exit(1);
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

/* -------------------------------- extract -------------------------------- */

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-verify-'));

/**
 * Extract the `.vsix` (a zip archive).
 *
 * `unzip` is preferred because GNU tar cannot read zip despite the extension;
 * bsdtar (bundled with modern Windows) can, so it is the fallback.
 */
function extract() {
  const attempts = [
    { cmd: 'unzip', args: ['-q', '-o', vsix, '-d', work] },
    { cmd: 'tar', args: ['-xf', vsix, '-C', work] }
  ];
  const errors = [];
  for (const { cmd, args } of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'pipe' });
      return cmd;
    } catch (err) {
      errors.push(`${cmd}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`could not extract the VSIX.\n  ${errors.join('\n  ')}`);
}

const extractor = extract();
const ext = path.join(work, 'extension');
assert.ok(fs.existsSync(ext), 'the archive must contain an extension/ directory');

console.log(`extracted with ${extractor}: ${vsix}\n  -> ${work}\n`);

/* --------------------------- contents are clean -------------------------- */

check('the archive carries no unexpected node_modules', () => {
  // `@libsql`, `libsql`, and `js-base64` are re-included on purpose by
  // `.vscodeignore`: the extension requires `@libsql/client` at runtime, and
  // `@libsql/core` needs `js-base64`. Any other module under `node_modules`
  // means the package is shipping dev deps.
  const ALLOWED = new Set(['@libsql', 'libsql', 'js-base64']);
  const found = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          for (const inner of fs.readdirSync(path.join(dir, entry.name))) {
            if (!ALLOWED.has(inner)) found.push(inner);
          }
        } else walk(path.join(dir, entry.name));
      }
    }
  })(ext);
  assert.deepEqual(found, [], 'a VSIX may only ship the @libsql/libsql runtime modules');
});

check('the archive carries no stray database files', () => {
  const stray = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(db|sqlite3?|libsql)$/i.test(entry.name)) stray.push(path.relative(ext, full));
    }
  })(ext);
  assert.deepEqual(stray, [], 'no test databases may be shipped');
});

check('the vendored sql.js and its wasm are present', () => {
  assert.ok(fs.existsSync(path.join(ext, 'out/vendor/sqljs/sql-wasm.js')), 'sql-wasm.js missing');
  assert.ok(fs.existsSync(path.join(ext, 'out/vendor/sqljs/sql-wasm.wasm')), 'sql-wasm.wasm missing');
});

check('the webview bundle is present', () => {
  const assets = path.join(ext, 'out/webview/assets');
  assert.ok(fs.existsSync(assets), 'out/webview/assets missing');
  assert.ok(
    fs.readdirSync(assets).some((f) => f.endsWith('.js')),
    'no webview script in out/webview/assets'
  );
});

/* ------------------------ sql.js must NOT be resolvable ------------------ */

check('sql.js is not resolvable from the extraction', () => {
  // Proves the bundled code cannot be silently borrowing the dev dependency.
  let resolved = null;
  try {
    resolved = require.resolve('sql.js', { paths: [ext] });
  } catch {
    resolved = null;
  }
  assert.equal(resolved, null, `sql.js resolved to ${resolved}; the VSIX is not self-contained`);
});

/* --------------------------- the adapter really works ------------------- */

const { SqlJsAdapter } = require(path.join(ext, 'out/extension/adapter/sqlJsAdapter.js'));

function runAdapterChecks() {
  const adapter = new SqlJsAdapter(path.join(ext, 'out/vendor/sqljs'));
  const dbPath = path.join(work, 'clean-room.db');
  // The editor opens files that exist; a new database is an existing zero-byte
  // file, which the adapter turns into an empty in-memory database. Creating the
  // file first mirrors how VS Code hands a freshly created `.db` to the editor.
  fs.writeFileSync(dbPath, '');

  const results = {};
  return adapter
    .open(dbPath)
    .then((open) => {
      results.open = open;
      return adapter.executeSql('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    })
    .then(() => adapter.executeSql("INSERT INTO t (name) VALUES ('libsql')"))
    // Pages are 0-based here; the UI adds 1 only for display.
    .then(() => adapter.query('SELECT id, name FROM t', 0, 50))
    .then((q) => {
      results.query = q;
      return adapter.close();
    })
    .then(() => results);
}

runAdapterChecks()
  .then((results) => {
    check('the vendored engine opens a new database', () => {
      assert.ok(results.open && !results.open.code, `open failed: ${JSON.stringify(results.open)}`);
      assert.equal(results.open.driver, 'sql.js', 'the WASM driver must be the one running queries');
    });

    check('the engine reports SQLite as its engine', () => {
      assert.equal(results.open.engine, 'sqlite', 'a plain SQLite file must not be labelled LibSQL');
    });

    check('a written row reads back', () => {
      const rows = results.query && results.query.rows;
      assert.ok(Array.isArray(rows), 'query did not return rows');
      assert.equal(rows.length, 1, `expected 1 row, got ${rows.length}`);
      assert.equal(rows[0][1] ?? rows[0].name, 'libsql');
    });

    check('an empty file is treated as a new, writable database', () => {
      // This is how VS Code hands over a freshly created `.db`; the adapter must
      // not report FILE_EMPTY as a blocking error.
      assert.ok(results.open && !results.open.code, `open failed: ${JSON.stringify(results.open)}`);
      assert.equal(results.open.writable, true, 'a new database must be writable');
    });

    check('the file on disk has a real SQLite header', () => {
      const head = fs.readFileSync(path.join(work, 'clean-room.db')).subarray(0, 16).toString('latin1');
      assert.equal(head, 'SQLite format 3\u0000', `unexpected header: ${JSON.stringify(head)}`);
    });

    check('the write survived to disk after close', () => {
      // The adapter keeps the DB in memory and persists after each write; this
      // is the guarantee that matters, so it is verified on the real bytes.
      const bytes = fs.readFileSync(path.join(work, 'clean-room.db'));
      assert.ok(bytes.length > 0, 'the file is still empty after a write');
      assert.ok(
        bytes.includes(Buffer.from('libsql', 'utf8')),
        'the inserted value is not present in the persisted file'
      );
    });

    return verifyCorruptHandling();
  })
  .then(() => {
    console.log(failures === 0 ? '\nALL CLEAN-ROOM CHECKS PASSED' : `\n${failures} CLEAN-ROOM CHECK(S) FAILED`);
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(`\nclean-room run failed: ${err && err.stack ? err.stack : err}`);
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(1);
  });

/** A non-database file must be classified, not reported as UNKNOWN. */
function verifyCorruptHandling() {
  const adapter = new SqlJsAdapter(path.join(ext, 'out/vendor/sqljs'));
  const corrupt = path.join(work, 'corrupt.db');
  fs.writeFileSync(corrupt, 'this is definitely not a database, not even close');
  return adapter.open(corrupt).then((r) => {
    check('a corrupt file is reported as DB_CORRUPT, not UNKNOWN', () => {
      assert.equal(r.code, 'DB_CORRUPT', `got ${r.code}: ${r.message}`);
    });
    return adapter.close();
  });
}
