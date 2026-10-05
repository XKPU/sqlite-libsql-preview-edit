// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Package an untargeted VSIX for the CURRENT host platform.
 *
 * This is the convenience path: it produces one VSIX with no target suffix,
 * usable only on the machine that built it (the native engine ships a binary
 * for the host alone). For per-platform artifacts, which is what the
 * Marketplace needs, use `npm run package:target` or the CI workflow.
 *
 * Output goes to `VSIX/<version>/`, matching `package-target.js`, so both
 * commands write to one predictable, git-ignored location instead of dropping
 * a `.vsix` in the repository root, where it would accumulate per run.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const outDir = path.join(root, 'VSIX', pkg.version);
fs.mkdirSync(outDir, { recursive: true });

const out = path.join(outDir, `${pkg.name}-${pkg.version}.vsix`);
const vsce = path.join(root, 'node_modules', 'vsce', 'vsce');

console.log(`=== packaging untargeted VSIX for the host (${process.platform}-${process.arch}) ===`);
try {
  execFileSync(process.execPath, [vsce, 'package', '-o', out], { cwd: root, stdio: 'inherit' });
} catch (err) {
  console.error(`\nFAILED to package: ${err.message.split('\n')[0]}`);
  process.exit(1);
}

const size = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`\nbuilt ${path.relative(root, out)} (${size} MB)`);
