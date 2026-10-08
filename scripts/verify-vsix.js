// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room verification of the packaged VSIX.
 *
 * Extracts the `.vsix` into a throwaway directory and runs the bundled
 * extension code from there. The point is to prove the *shipped artifact* is
 * self-contained: it may resolve only the runtime packages it declares, not
 * anything from the development `node_modules`, because that directory does not
 * exist on a user's machine.
 *
 * Checks:
 *   1. the archive carries no `node_modules` beyond the runtime packages
 *      that `.vscodeignore` deliberately re-includes (`libsql` + its binary
 *      package `@libsql/<target>` + `@neon-rs/load` + `detect-libc`, which
 *      `require('libsql')` resolves at runtime) and no stray files, and that
 *      the engine's per-platform binary survived
 *   2. no removed WASM engine is shipped: neither the vendored `out/vendor`
 *      payload nor an `sql.js` module may appear in the archive
 *   3. the native adapter opens, creates, writes, reads, and closes a DB
 *   4. the on-disk file carries a real SQLite header
 *   5. a corrupt file is classified as DB_CORRUPT rather than UNKNOWN
 *   6. no removed engine (`better-sqlite3`, `@tursodatabase/database`) ships,
 *      and the driver answering queries is the libsql one — the assertion that
 *      catches the shipped build silently resolving a different engine
 *
 * Run: node scripts/verify-vsix.js [path/to/extension-target.vsix]
 */
'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// An explicit path may be passed (CI packages one VSIX per platform target with
// a target suffix in the filename). Without an argument, fall back to the
// default `npm run package` output name.
const vsix = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, `${pkg.name}-${pkg.version}.vsix`);

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
  // The engine's runtime closure is re-included on purpose by `.vscodeignore`:
  //   libsql            the engine JS (loader + auth + error types)
  //   @libsql/<target>  the per-platform native binary (pruned to one per VSIX)
  //   @neon-rs/load     resolves the binary path at require time
  //   detect-libc       musl vs glibc detection for the Linux binary remap
  // These are the ONLY modules `require('libsql')` can reach, so any other
  // module under `node_modules` means the package is shipping dev deps (or
  // leftovers from a previous engine).
  const ALLOWED = new Set(['libsql', '@libsql', '@neon-rs', 'detect-libc']);
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
  assert.deepEqual(found, [], 'a VSIX may only ship the libsql runtime modules');
});

check('the archive ships exactly one engine binary package', () => {
  // The one thing a pruned `node_modules` can silently break. The loader in
  // `node_modules/libsql/index.js` resolves `@libsql/<target>` at require time;
  // this VSIX must carry exactly one binary package (its own target's), with an
  // `index.node` actually inside — if the re-include ever stops working, the
  // VSIX still builds and every user gets a load failure.
  const scope = path.join(ext, 'node_modules/@libsql');
  assert.ok(fs.existsSync(scope), 'node_modules/@libsql missing');
  const packages = fs.readdirSync(scope).filter((d) =>
    fs.existsSync(path.join(scope, d, 'index.node'))
  );
  assert.equal(packages.length, 1, `exactly one @libsql binary must ship (found: ${packages.join(', ')})`);
  assert.ok(
    fs.statSync(path.join(scope, packages[0], 'index.node')).size > 1024 * 1024,
    'the shipped index.node is implausibly small to be a real engine binary'
  );
});

check('the archive ships no removed engine', () => {
  // better-sqlite3 (the previous driver) and @tursodatabase/database (the
  // rejected Rust rewrite) must be gone — their presence would mean the
  // adapter's require would silently resolve a different engine than the one
  // the capability panel reports.
  for (const gone of ['better-sqlite3', '@tursodatabase']) {
    assert.ok(
      !fs.existsSync(path.join(ext, 'node_modules', gone)),
      `the removed engine ${gone} is still shipped`
    );
  }
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

check('the webview bundle is present', () => {
  const assets = path.join(ext, 'out/webview/assets');
  assert.ok(fs.existsSync(assets), 'out/webview/assets missing');
  assert.ok(
    fs.readdirSync(assets).some((f) => f.endsWith('.js')),
    'no webview script in out/webview/assets'
  );
});

/* ------------------- the removed WASM engine must be gone ---------------- */

check('the archive carries no vendored sql.js payload', () => {
  // `out/vendor/` only ever held the vendored sql.js loader and its `.wasm`.
  // The engine is gone, so the directory (and any stray module named sql.js)
  // must not be shipped either.
  const vendor = path.join(ext, 'out/vendor');
  assert.ok(!fs.existsSync(vendor), `the removed vendored engine is still shipped: ${vendor}`);

  const stray = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'sql.js') stray.push(path.relative(ext, path.join(dir, entry.name)));
        else walk(path.join(dir, entry.name));
      } else if (/sql-?js/i.test(entry.name)) {
        stray.push(path.relative(ext, path.join(dir, entry.name)));
      }
    }
  })(ext);
  assert.deepEqual(stray, [], 'no sql.js module may be shipped in the VSIX');
});

/* --------------------------- the adapter really works ------------------- */

/**
 * Locate the adapter module inside the EXTRACTED extension.
 *
 * The adapter may be renamed (e.g. `libSqlAdapter.js` -> `tursoAdapter.js`), and
 * this script must survive that rename, so the module is DISCOVERED rather than
 * hardcoded. `adapter.js`/`common.js` are supporting modules, never the adapter
 * itself; the adapter is the one that exports a `*Adapter` class.
 */
function findAdapterModule(extensionDir) {
  const dir = path.join(extensionDir, 'out/extension/adapter');
  if (!fs.existsSync(dir)) return undefined;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => f !== 'adapter.js' && f !== 'common.js')
    .map((f) => path.join(dir, f))
    .find((full) => {
      try {
        const mod = require(full);
        return Object.keys(mod).some((k) => /Adapter$/.test(k) && typeof mod[k] === 'function');
      } catch {
        return false;
      }
    });
}

const adapterPath = findAdapterModule(ext);
assert.ok(adapterPath, 'the packaged extension must carry a compiled adapter module');
const adapterModule = require(adapterPath);
const adapterClassName = Object.keys(adapterModule).find(
  (k) => /Adapter$/.test(k) && typeof adapterModule[k] === 'function'
);
const LibSqlAdapter = adapterModule[adapterClassName];

function runAdapterChecks() {
  const adapter = new LibSqlAdapter();
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
    .then(() => adapter.executeSql("INSERT INTO t (name) VALUES ('shipped')"))
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
    check('the native libsql engine opens a new database', () => {
      assert.ok(results.open && !results.open.code, `open failed: ${JSON.stringify(results.open)}`);
      // Exact match, not just "non-empty": this is the assertion that would
      // catch the shipped build resolving a different engine than intended.
      assert.equal(
        results.open.driver,
        'libsql',
        'the libsql driver must be the one running queries'
      );
    });

    check('a written row reads back', () => {
      const rows = results.query && results.query.rows;
      assert.ok(Array.isArray(rows), 'query did not return rows');
      assert.equal(rows.length, 1, `expected 1 row, got ${rows.length}`);
      assert.equal(rows[0][1] ?? rows[0].name, 'shipped');
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
        bytes.includes(Buffer.from('shipped', 'utf8')),
        'the inserted value is not present in the persisted file'
      );
    });
  })
  /* The corruption check runs last; `finish` reports and sets the exit code. */
  .then(verifyCorruptHandling)
  .then(finish, (err) => {
    console.error(`\nclean-room run failed: ${err && err.stack ? err.stack : err}`);
    failures++;
    finish();
  });

/**
 * Remove the throwaway extraction directory, best effort.
 *
 * On Windows a just-closed SQLite file can still be held briefly, so `rmSync`
 * raises EPERM. That is an artifact of the test machine, not a packaging
 * defect: the checks have already run, so cleanup must never change the exit
 * code or mask the results.
 */
function cleanup() {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.log(`  note: could not remove ${work} (${err.code || err.message}); ignoring`);
  }
}

/** Report the result and exit. The single place the exit code is decided. */
function finish() {
  console.log(
    failures === 0 ? '\nALL CLEAN-ROOM CHECKS PASSED' : `\n${failures} CLEAN-ROOM CHECK(S) FAILED`
  );
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * A non-database file must be classified, not reported as UNKNOWN.
 *
 * The file must be at least one page long, otherwise SQLite can answer a
 * metadata-free query without ever reading a header and no corruption is
 * reported. And the verdict only appears once the engine actually reads the
 * file: `open()` gathers size/stat information, so the classification is
 * observed by issuing the first real query, which is what a user's first
 * interaction does anyway.
 */
function verifyCorruptHandling() {
  const adapter = new LibSqlAdapter();
  const corrupt = path.join(work, 'corrupt.db');
  // 64 KiB of non-SQLite bytes: large enough that the header must be parsed.
  fs.writeFileSync(corrupt, Buffer.alloc(65536, 0x41));
  return adapter
    .open(corrupt)
    .then((r) => {
      if (r && r.code) {
        check('a corrupt file is reported as DB_CORRUPT, not UNKNOWN', () => {
          assert.equal(r.code, 'DB_CORRUPT', `open() returned ${r.code}: ${r.message}`);
        });
        return undefined;
      }
      return adapter.executeSql('SELECT count(*) FROM sqlite_master').then((q) => {
        check('a corrupt file is reported as DB_CORRUPT, not UNKNOWN', () => {
          assert.equal(q.code, 'DB_CORRUPT', `got ${q.code}: ${q.message}`);
        });
      });
    })
    .then(() => adapter.close());
}
