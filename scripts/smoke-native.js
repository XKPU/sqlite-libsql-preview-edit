// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Prove the native SQLite engine for the CURRENT platform loads and can open a
 * real database file.
 *
 * Why this exists: the extension ships `better-sqlite3`, which resolves a
 * platform-specific prebuilt binary (`prebuilds/<platform>-<arch>.node`) at run
 * time. If a packaging step drops the wrong one — or the package is pruned so
 * aggressively that the prebuilds directory does not survive — the VSIX builds
 * fine and fails for every user. This script fails the build instead.
 *
 * It deliberately uses the SAME entry point the extension uses — the compiled
 * adapter — so a broken factory or a changed client API is caught here too.
 *
 * Run: node scripts/smoke-native.js
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * Locate the compiled adapter module in `out/extension/adapter/`.
 *
 * The adapter may be renamed (e.g. `sqliteAdapter.js` -> `sqlite3Adapter.js`), so
 * the file is DISCOVERED rather than hardcoded. `adapter.js`/`common.js` are
 * supporting modules, never the adapter itself; the adapter is the one that
 * exports a `*Adapter` class.
 *
 * Discovery alone is not enough to pick the right one, and this bit the build
 * once: when two adapters were present, taking the first match tested whichever
 * the filesystem happened to list first — not the one the extension actually
 * loads. The selection is therefore anchored to the implementation the host
 * really uses, by asking `DatabaseEditorProvider` which class it constructs.
 */
function findAdapterModules() {
  const dir = path.join(root, 'out', 'extension', 'adapter');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => f !== 'adapter.js' && f !== 'common.js')
    .map((f) => path.join(dir, f))
    .filter((full) => {
      try {
        const mod = require(full);
        return Object.keys(mod).some((k) => /Adapter$/.test(k) && typeof mod[k] === 'function');
      } catch {
        return false;
      }
    });
}

/**
 * The adapter class the extension actually constructs at runtime.
 *
 * Read out of the compiled provider's source rather than guessed, so this script
 * always exercises the shipped driver. TypeScript emits the construction through
 * the module namespace (`new sqliteAdapter_1.SqliteAdapter()`), so the match
 * allows an optional `alias.` prefix and returns only the class name.
 *
 * Returns the class name, or `null` when the provider cannot be read (reported as
 * a failure by the caller).
 */
function adapterInUse() {
  const provider = path.join(root, 'out', 'extension', 'DatabaseEditorProvider.js');
  if (!fs.existsSync(provider)) return null;
  const src = fs.readFileSync(provider, 'utf8');
  const match = src.match(/new\s+(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*Adapter)\s*\(/);
  return match ? match[1] : null;
}

const adapters = findAdapterModules();
const wanted = adapterInUse();

if (!wanted) {
  console.error(
    'Could not tell which adapter DatabaseEditorProvider constructs.\nRun "npm run compile:extension" first.'
  );
  process.exit(1);
}

const exported =
  adapters.find((full) => {
    const mod = require(full);
    return typeof mod[wanted] === 'function';
  }) ?? null;

if (!exported) {
  console.error(
    `The provider constructs ${wanted}, but no compiled adapter exports it.\n` +
      `Found: ${adapters.map((f) => path.basename(f)).join(', ') || '(none)'}\n` +
      'Run "npm run compile:extension" first.'
  );
  process.exit(1);
}

/**
 * Report which prebuilt binary this platform will load, for the log.
 *
 * `better-sqlite3` picks the binary itself from `process.platform`/`process.arch`
 * (and musl detection on Linux), so the useful fact is not which optional package
 * got installed but WHICH prebuild resolves — and whether it is actually present.
 * A missing prebuild is the failure this script exists to catch, so it is reported
 * explicitly rather than left to a require() stack trace.
 */
function describeRuntime() {
  const lines = [];

  let pkgPath = null;
  try {
    pkgPath = require.resolve('better-sqlite3/package.json', { paths: [root] });
  } catch {
    lines.push('better-sqlite3 -> (not installed)');
    return lines;
  }
  lines.push(`better-sqlite3 -> ${path.relative(root, pkgPath)}`);

  // `lib/binding.js` exposes the same resolver the addon uses at require time,
  // so asking it is a stronger check than recomputing the path ourselves.
  try {
    const binding = require(path.join(path.dirname(pkgPath), 'lib', 'binding.js'));
    if (typeof binding.getPrebuildPath === 'function') {
      const prebuild = binding.getPrebuildPath();
      lines.push(
        prebuild
          ? `prebuild       -> ${path.relative(root, prebuild)}`
          : `prebuild       -> (none for ${process.platform}-${process.arch}; would build from source)`
      );
    }
  } catch {
    lines.push('prebuild       -> (could not resolve lib/binding.js)');
  }
  return lines;
}

(async () => {
  console.log(`platform: ${process.platform}-${process.arch} (node ${process.versions.node})`);
  for (const line of describeRuntime()) console.log(`  ${line}`);
  console.log(`adapter : ${path.relative(root, exported)}`);

  const adapterModule = require(exported);
  // The class the provider constructs, resolved above — not "whatever this file
  // happens to export first".
  const AdapterClass = adapterModule[wanted];
  assert.equal(typeof AdapterClass, 'function', `${wanted} must be exported by the adapter module`);

  const file = path.join(os.tmpdir(), `smoke-native-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(file, '');

  try {
    const adapter = new AdapterClass();
    const info = await adapter.open(file);
    assert.ok(!info.code, `opening a database failed: ${info.code} ${info.message}`);
    console.log(`opened   : driver=${info.driver} engine=${info.engine} version=${info.version}`);

    await adapter.executeSql(
      'CREATE TABLE smoke (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)'
    );
    await adapter.executeSql("INSERT INTO smoke (name) VALUES ('a'), ('b')");
    const res = await adapter.executeSql('SELECT id, name FROM smoke ORDER BY id');
    assert.equal(res.rows.length, 2, 'both inserted rows must come back');
    console.log(`query    : ${JSON.stringify(res.rows)}`);

    // Concurrency regression. The webview posts messages without awaiting the
    // answers, so two quick actions really do reach the adapter at once. A
    // database connection can host only one transaction at a time, so without
    // serialization the second one fails outright — "cannot start a transaction
    // within a transaction" — and its work is silently lost.
    const concurrent = await Promise.allSettled([
      adapter.executeDdl(['CREATE TABLE conc_a (id INTEGER PRIMARY KEY)']),
      adapter.executeDdl(['CREATE TABLE conc_b (id INTEGER PRIMARY KEY)'])
    ]);
    const rejected = concurrent.filter((r) => r.status === 'rejected');
    assert.equal(
      rejected.length,
      0,
      `concurrent DDL must all succeed, got: ${rejected.map((r) => String(r.reason)).join('; ')}`
    );
    const afterConcurrent = await adapter.getObjects(false);
    const created = afterConcurrent.filter((o) => o.name.startsWith('conc_')).map((o) => o.name);
    assert.equal(
      created.length,
      2,
      `both concurrent tables must exist, found: ${JSON.stringify(created)}`
    );
    console.log(`concurrent : ${created.length}/2 tables created, no failures`);

    await adapter.close();

    // The decisive assertion: the data reached the DISK, not a private buffer.
    // (This is exactly what the WASM client fails to do.)
    const size = fs.statSync(file).size;
    assert.ok(size > 0, 'the database file must have bytes on disk after a write');
    const header = fs.readFileSync(file).subarray(0, 15).toString('utf8');
    assert.equal(header, 'SQLite format 3', `unexpected file header: ${JSON.stringify(header)}`);
    console.log(`on disk  : ${size} bytes, header OK`);

    console.log('\nSMOKE TEST PASSED');
  } finally {
    // Windows may keep the handle briefly after close(); a failed unlink must
    // not fail an otherwise-passing smoke test.
    try {
      fs.unlinkSync(file);
    } catch {
      /* best effort */
    }
  }
})().catch((err) => {
  console.error(`\nSMOKE TEST FAILED: ${err.message}`);
  process.exit(1);
});
