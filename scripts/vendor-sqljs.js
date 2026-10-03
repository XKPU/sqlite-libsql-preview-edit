#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vendor the sql.js runtime into the build output.
 *
 * `src/extension/adapter/sqlJsAdapter.ts` loads sql.js at runtime, but
 * `.vscodeignore` keeps `node_modules/` out of the VSIX (otherwise every dev
 * dependency would ship). So the published extension would `require('sql.js')`
 * and crash on the very first database open.
 *
 * This script copies exactly the two files the runtime needs — the loader and
 * its WebAssembly payload — into `out/vendor/sqljs/`, which *is* packaged. The
 * adapter loads them from there and points `locateFile` at the same directory
 * so the `.wasm` is resolved without touching node_modules.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'node_modules', 'sql.js', 'dist');
const outDir = path.join(root, 'out', 'vendor', 'sqljs');

// The loader and the WASM it fetches via locateFile(); nothing else is needed.
const FILES = ['sql-wasm.js', 'sql-wasm.wasm'];

function main() {
  if (!fs.existsSync(srcDir)) {
    console.error(`vendor-sqljs: sql.js is not installed at ${srcDir}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of FILES) {
    const from = path.join(srcDir, file);
    if (!fs.existsSync(from)) {
      console.error(`vendor-sqljs: missing ${from}`);
      process.exit(1);
    }
    fs.copyFileSync(from, path.join(outDir, file));
  }
  const bytes = FILES.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`vendored sql.js (${FILES.join(', ')}) -> out/vendor/sqljs (${bytes} bytes)`);
}

main();
