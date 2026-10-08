// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Package a platform-targeted VSIX locally, the same way CI does it.
 *
 * A target suffix is REQUIRED for the marketplace flow: the engine, the `libsql`
 * npm package, publishes one optional binary package per platform
 * (`node_modules/@libsql/<target>/index.node`), and each VSIX must carry only
 * its own platform's binary — shipping all nine would bloat every download by
 * ~45 MB of dead weight. `scripts/package-untargeted.js` is the convenience
 * path for the current host.
 *
 * MEASURED CAVEAT this script exists to work around: `vsce package --target`
 * does NOT prune `optionalDependencies` by their `os`/`cpu` fields — verified
 * on vsce 4.x, a `--target darwin-arm64` package still carried the
 * win32-x64-msvc binary and lacked the darwin one. The pruning is therefore
 * done HERE, by staging `node_modules` down to the target's binary before each
 * `vsce` invocation (see `pruneOtherBinaries`).
 *
 * Usage:
 *   node scripts/package-target.js <target> [more targets...]
 *   node scripts/package-target.js --list
 *
 * Targets are `vsce`'s, not npm's. Only the ones the engine actually ships a
 * binary for are accepted — see `SUPPORTED` below. `vsce` would happily package
 * the others, but the result could not load its engine, so they are rejected
 * here rather than producing a broken artifact. No per-target install step is
 * needed: staging reuses the binaries already present under
 * `node_modules/@libsql/`, and refuses a target whose binary is missing.
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
 * binary packages `libsql` publishes as optionalDependencies (darwin-arm64,
 * darwin-x64, win32-x64-msvc, linux-{x64,arm64}-{gnu,musl},
 * linux-arm-{gnueabihf,musleabihf}). Only the four platforms this extension
 * advertises are packaged; the loader remaps musl→gnu on Linux (see
 * `node_modules/libsql/index.js`), so the gnu binaries also serve musl users —
 * which is why the musl targets are not separately advertised. Keep this in
 * sync with the CI matrix in .github/workflows/release.yml.
 */
const SUPPORTED = ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

/**
 * The `@libsql/<target>` binary package name each VSIX target needs.
 *
 * Mirrors the resolution in `node_modules/libsql/index.js` (@neon-rs/load's
 * currentTarget() with the musl→gnu remap). npm installs the binary packages
 * as `@libsql/<name>` directories; a missing directory means the host's
 * install was pruned to another platform, and packaging that target is refused
 * rather than shipping a VSIX that cannot load its engine.
 */
const TARGET_BINARY_PACKAGE = {
  'win32-x64': '@libsql/win32-x64-msvc',
  'darwin-arm64': '@libsql/darwin-arm64',
  'darwin-x64': '@libsql/darwin-x64',
  'linux-x64': '@libsql/linux-x64-gnu',
  'linux-arm64': '@libsql/linux-arm64-gnu'
};

/**
 * The prebuilt binary packages the installed engine actually carries.
 *
 * Read from disk so the set is discovered, not assumed: if an upgrade adds a
 * platform, this reports it, and if the install is pruned so a platform is
 * missing, packaging that target can be refused before producing a broken VSIX.
 */
function installedBinaryPackages() {
  try {
    return fs
      .readdirSync(path.join(root, 'node_modules', '@libsql'))
      .filter((d) => fs.existsSync(path.join(root, 'node_modules', '@libsql', d, 'index.node')));
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

/**
 * Prune `node_modules/@libsql` down to what ONE target's VSIX may ship.
 *
 * vsce does not prune the per-platform `@libsql/*` binaries by target (measured,
 * see the header). The rest of `node_modules` needs no manipulation at all:
 * `.vscodeignore` already excludes every dev dependency from the archive
 * (`node_modules/**` plus positive re-includes for the four runtime packages),
 * so the ONLY thing that would otherwise leak into every VSIX is the sibling
 * `@libsql/*` binary packages, which the re-include `!node_modules/@libsql/**`
 * opens the gate for. Temporarily removing the other binaries is therefore both
 * necessary and sufficient.
 *
 * The removed directories are MOVED into `.vsix-stage/` and moved back after
 * the `vsce` run — including on failure — so a developer's install is never
 * left pruned, and building several targets in a row works. (Move, not copy:
 * binaries are tens of MB and the copy showed no benefit.)
 *
 * Refuses to run when the target's binary was never installed (the host's npm
 * install only fetches the host platform's optional dependency): cross-target
 * packaging first needs the binary present, e.g.
 * `npm install @libsql/darwin-arm64 --no-save` (or the CI workflow, which
 * installs per runner).
 */
function pruneOtherBinaries(target) {
  const binaryName = TARGET_BINARY_PACKAGE[target].slice('@libsql/'.length);
  const binaryDir = path.join(root, 'node_modules', '@libsql', binaryName);
  if (!fs.existsSync(path.join(binaryDir, 'index.node'))) {
    throw new Error(
      `the binary package for ${target} (@libsql/${binaryName}) is not installed. ` +
        `Installed: ${installedBinaryPackages().join(', ') || '(none)'}. ` +
        `Install it with: npm install ${TARGET_BINARY_PACKAGE[target]} --no-save`
    );
  }

  const libsqlDir = path.join(root, 'node_modules', '@libsql');
  const stageDir = path.join(root, '.vsix-stage');
  fs.mkdirSync(stageDir, { recursive: true });

  const removed = [];
  for (const dir of fs.readdirSync(libsqlDir)) {
    if (dir !== binaryName) {
      fs.renameSync(path.join(libsqlDir, dir), path.join(stageDir, `@libsql-${dir}`));
      removed.push(dir);
    }
  }

  return () => {
    for (const dir of removed) {
      const staged = path.join(stageDir, `@libsql-${dir}`);
      if (fs.existsSync(staged)) {
        fs.renameSync(staged, path.join(libsqlDir, dir));
      }
    }
  };
}

let failed = 0;
for (const target of argv) {
  const out = path.join(outDir, `${pkg.name}-${target}.vsix`);
  console.log(`\n=== packaging ${target} ===`);
  let restore;
  try {
    restore = pruneOtherBinaries(target);
  } catch (err) {
    console.error(`SKIPPED ${target}: ${err.message}`);
    failed++;
    continue;
  }
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
  } finally {
    restore();
  }
}

if (failed > 0) {
  console.error(`\n${failed} target(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${argv.length} target(s) packaged into ${path.relative(root, outDir)}/`);
