import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqlJsAdapter } from '../src/extension/adapter/sqlJsAdapter';

/**
 * End-to-end check of the packaged engine path.
 *
 * The VSIX excludes `node_modules`, so the build vendors the sql.js loader and
 * its `.wasm` into `out/vendor/sqljs`. These tests exercise that exact copy —
 * the same one an installed extension uses — rather than the node_modules
 * import, so a packaging regression (missing WASM, wrong locateFile) fails the
 * suite instead of failing silently on a user's machine.
 *
 * If the vendor directory is absent (a fresh checkout that has not been built),
 * the tests skip rather than fail, because `npm test` compiles but does not
 * always run the vendoring step.
 */
const vendorDir = path.resolve(__dirname, '..', '..', '..', 'out', 'vendor', 'sqljs');
const haveVendor = fs.existsSync(path.join(vendorDir, 'sql-wasm.js'));

describe('vendored sql.js runtime', { skip: !haveVendor && 'run npm run compile first' }, () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'libsql-vendor-'));
  });

  after(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('ships the loader and its WASM payload together', () => {
    assert.ok(fs.existsSync(path.join(vendorDir, 'sql-wasm.js')), 'loader missing');
    assert.ok(fs.existsSync(path.join(vendorDir, 'sql-wasm.wasm')), 'wasm missing');
  });

  it('opens a database through the vendored engine only', async () => {
    const file = path.join(tmpDir, 'vendored.db');
    await fs.promises.writeFile(file, Buffer.alloc(0));
    const adapter = new SqlJsAdapter(vendorDir);

    const info = await adapter.open(file);
    assert.equal('code' in info, false, `open failed: ${JSON.stringify(info)}`);
    assert.ok((info as { version: string }).version.length > 0);
    // The info panel shows both the driver (implementation) and the engine
    // (dialect); neither may be blank, or the UI renders an empty row.
    assert.ok((info as { driver: string }).driver.length > 0, 'driver must be populated');
    assert.ok((info as { engine: string }).engine.length > 0, 'engine must be populated');

    const ddl = await adapter.executeStatements([
      'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);',
      "INSERT INTO t (v) VALUES ('vendored');"
    ]);
    assert.equal('code' in ddl, false, `write failed: ${JSON.stringify(ddl)}`);

    const res = await adapter.executeSql('SELECT v FROM t');
    assert.equal('code' in res, false);
    assert.deepEqual((res as { rows: unknown[][] }).rows, [['vendored']]);

    // The file on disk must be a real SQLite database after the write.
    await adapter.close();
    const bytes = await fs.promises.readFile(file);
    assert.ok(bytes.length > 0, 'nothing was persisted');
    assert.equal(bytes.subarray(0, 15).toString('latin1'), 'SQLite format 3');
  });

  it('detects the SQLite baseline for a plain file', async () => {
    const file = path.join(tmpDir, 'plain.sqlite');
    await fs.promises.writeFile(file, Buffer.alloc(0));
    const adapter = new SqlJsAdapter(vendorDir);
    const info = await adapter.open(file);
    assert.equal('code' in info, false);
    assert.equal((info as { engine: string }).engine, 'sqlite');
    assert.equal(adapter.isLibSql(), false);
    await adapter.close();
  });

  it('loads the adapter module without sql.js resolvable from node_modules', () => {
    // Regression guard: the engine import used to be a top-level
    // `require('sql.js')`. That resolves fine in the repo but throws at module
    // load inside an installed VSIX, where node_modules is not packaged — so
    // the extension died before the vendored copy could ever be used. The
    // adapter must therefore load with sql.js entirely unresolvable.
    const before = require('module').Module._resolveFilename;
    require('module').Module._resolveFilename = function (request: string, ...rest: unknown[]) {
      if (request === 'sql.js') {
        const err: NodeJS.ErrnoException = new Error("Cannot find module 'sql.js'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return before.call(this, request, ...rest);
    };
    try {
      const adapterPath = require.resolve('../src/extension/adapter/sqlJsAdapter');
      delete require.cache[adapterPath];
      assert.doesNotThrow(() => require(adapterPath), 'adapter must load without sql.js');
    } finally {
      require('module').Module._resolveFilename = before;
    }
  });
});
