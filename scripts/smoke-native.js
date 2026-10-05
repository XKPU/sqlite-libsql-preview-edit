// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Prove the native Turso Database engine for the CURRENT platform loads and can
 * open a real database file.
 *
 * Why this exists: the extension ships `@tursodatabase/database`, which resolves
 * a platform-specific binary (`@tursodatabase/database-<platform>`) at run time.
 * If a CI packaging step installs the wrong platform's optional dependency (a
 * stray `npm_config_arch`, a cache hit from another matrix entry), the VSIX
 * builds fine and fails for every user. This script fails the build instead.
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
 * The adapter may be renamed (e.g. `libSqlAdapter.js` -> `tursoAdapter.js`), and
 * this script must survive that rename, so the file is DISCOVERED rather than
 * hardcoded. `adapter.js`/`common.js` are supporting modules, never the adapter
 * itself; the adapter is the one that exports a `*Adapter` class.
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

const adapters = findAdapterModules();
const exported = adapters[0];

if (!exported) {
  console.error(
    'Compiled adapter not found in out/extension/adapter/\nRun "npm run compile:extension" first.'
  );
  process.exit(1);
}

/** Where the native binary resolved from, for the log. */
function describeRuntime() {
  const tried = [];
  for (const name of [
    `@tursodatabase/database-${process.platform}-${process.arch}`,
    '@tursodatabase/database-win32-x64-msvc',
    '@tursodatabase/database-linux-x64-gnu',
    '@tursodatabase/database-linux-arm64-gnu',
    '@tursodatabase/database-darwin-arm64',
    '@tursodatabase/database'
  ]) {
    try {
      const pkgPath = require.resolve(`${name}/package.json`, { paths: [root] });
      tried.push(`${name} -> ${path.relative(root, pkgPath)}`);
    } catch {
      tried.push(`${name} -> (not installed)`);
    }
  }
  return tried;
}

(async () => {
  console.log(`platform: ${process.platform}-${process.arch} (node ${process.versions.node})`);
  for (const line of describeRuntime()) console.log(`  ${line}`);
  console.log(`adapter : ${path.relative(root, exported)}`);

  const adapterModule = require(exported);
  const className = Object.keys(adapterModule).find(
    (k) => /Adapter$/.test(k) && typeof adapterModule[k] === 'function'
  );
  const LibSqlAdapter = adapterModule[className];
  assert.equal(typeof LibSqlAdapter, 'function', 'the adapter class must be exported');

  const file = path.join(os.tmpdir(), `smoke-native-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(file, '');

  try {
    const adapter = new LibSqlAdapter();
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
