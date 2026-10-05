// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Package a platform-targeted VSIX locally, the same way CI does it.
 *
 * A single VSIX cannot serve every OS/arch, because the native Turso Database
 * engine resolves a platform-specific binary
 * (`@tursodatabase/database-<platform>`) that only exists for the machine that
 * ran `npm install`. VS Code solves this with a target suffix: the Marketplace
 * keeps one VSIX per target under the same version, and each user's VS Code
 * downloads the matching one.
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
 * IMPORTANT: this only packages for the target NAME; it does not install that
 * target's native binary. Cross-building a platform therefore requires the
 * matching optional dependency to be present in node_modules first, which is
 * what the CI matrix does with npm's target-arch env vars. The script builds on
 * the current host only when the target matches the host.
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
 * platform packages `@tursodatabase/database` publishes as optional
 * dependencies. Upstream provides no binary for win32-arm64, darwin-x64 or
 * musl/Alpine, so packaging those would produce a VSIX whose engine cannot
 * load. Keep this in sync with the CI matrix in .github/workflows/release.yml.
 */
const SUPPORTED = ['win32-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'];

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

const vsce = path.join(root, 'node_modules', 'vsce', 'vsce');

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
