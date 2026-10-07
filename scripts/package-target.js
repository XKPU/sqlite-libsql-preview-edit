// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Package a platform-targeted VSIX locally, the same way CI does it.
 *
 * A target suffix is no longer REQUIRED to produce a working artifact: the engine,
 * `better-sqlite3`, ships every platform's prebuilt binary inside the one package
 * (`prebuilds/<platform>-<arch>.node`), so a single untargeted VSIX loads on all of
 * them. See `package-untargeted.js` for that build.
 *
 * This script still exists for the Marketplace flow, where one VSIX per target
 * lets each user's VS Code download only the matching payload instead of every
 * platform's binary, and it is what the CI matrix runs.
 *
 * Usage:
 *   node scripts/package-target.js <target> [more targets...]
 *   node scripts/package-target.js --list
 *
 * Targets are `vsce`'s, not npm's. Only the four the engine actually ships a
 * binary for are accepted — see `SUPPORTED` below. `vsce` would happily package
 * the others, but the result could not load its engine, so they are rejected
 * here rather than producing a broken artifact.
 *
 * Unlike the optional-dependency engines of the past, no install step is needed
 * per target: the prebuilds travel inside `better-sqlite3` itself, so this
 * packages for any supported target from any host.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * The targets this extension can actually ship.
 *
 * This is deliberately narrower than `vsce --target`'s list: it mirrors the
 * prebuilt binaries `better-sqlite3` publishes under `prebuilds/`. See
 * `packagedPrebuilds()` below, which reads that list from the installed engine
 * rather than trusting this constant, so a package that ships an extra platform
 * is noticed instead of silently ignored. Upstream also provides musl/Alpine
 * binaries (`linuxmusl-*`) and win32-arm64, but the extension has never
 * advertised those targets; keep this in sync with the CI matrix in
 * .github/workflows/release.yml.
 */
const SUPPORTED = ['win32-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'];

/**
 * The prebuilt binaries the installed engine actually carries.
 *
 * Read from disk so the set is discovered, not assumed: if an upgrade adds a
 * platform, this reports it, and if the install is pruned so a platform is
 * missing, packaging that target can be refused before producing a broken VSIX.
 */
function packagedPrebuilds() {
  try {
    const pkg = require.resolve('better-sqlite3/package.json', { paths: [root] });
    const dir = path.join(path.dirname(pkg), 'prebuilds');
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.node'))
      .map((f) => f.replace(/\.node$/, ''));
  } catch {
    return [];
  }
}

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(`Usage: node scripts/package-target.js <target> [...]\n\nTargets: ${SUPPORTED.join(', ')}\n`);
  process.exit(argv.length === 0 ? 1 : 0);
}

if (argv.includes('--list')) {
  for (const t of SUPPORTED) console.log(t);
  process.exit(0);
}

const unknown = argv.filter((t) => !SUPPORTED.includes(t));
if (unknown.length > 0) {
  console.error(`Unknown target(s): ${unknown.join(', ')}\nValid: ${SUPPORTED.join(', ')}`);
  process.exit(1);
}

/**
 * Where packaged VSIXs are written: `VSIX/<version>/`.
 *
 * Version-scoped so builds for several releases can sit side by side and an
 * older artifact is never silently overwritten by a newer one. The whole
 * `VSIX/` tree is git-ignored — these are build outputs the user downloads, not
 * sources to commit.
 */
const outDir = path.join(root, 'VSIX', pkg.version);
fs.mkdirSync(outDir, { recursive: true });

// `vsce` was renamed to `@vscode/vsce`; the bin path layout is unchanged.
const vsce = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');

let failed = 0;
for (const target of argv) {
  const out = path.join(outDir, `${pkg.name}-${target}.vsix`);
  console.log(`\n=== packaging ${target} ===`);
  try {
    // One --target per invocation: older vsce only accepts a single value.
    execFileSync(process.execPath, [vsce, 'package', '--target', target, '-o', out], {
      cwd: root,
      stdio: 'inherit'
    });
    const size = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
    console.log(`built ${path.relative(root, out)} (${size} MB)`);
  } catch (err) {
    failed++;
    console.error(`FAILED to package ${target}: ${err.message.split('\n')[0]}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} target(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${argv.length} target(s) packaged into ${path.relative(root, outDir)}/`);
