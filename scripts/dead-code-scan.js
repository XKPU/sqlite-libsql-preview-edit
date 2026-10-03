// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dead-code scan: finds exported symbols in `src/` and `webview/src/` that are
 * referenced nowhere outside their own file.
 *
 * Written as a file (not a shell heredoc) because backslashes in regex literals
 * do not survive shell quoting intact.
 *
 * Run: node scripts/dead-code-scan.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'webview', 'src'))];
const allFiles = [
  ...sourceFiles,
  ...walk(path.join(root, 'test')),
  path.join(root, 'scripts', 'test-runner.js'),
  path.join(root, 'scripts', 'verify-message-router.js'),
  path.join(root, 'scripts', 'vendor-sqljs.js'),
  path.join(root, 'vite.config.ts'),
  path.join(root, 'package.json')
].filter((f) => fs.existsSync(f));

const texts = new Map(allFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

const DECL = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

const symbols = [];
for (const file of sourceFiles) {
  const src = texts.get(file);
  let m;
  while ((m = DECL.exec(src))) symbols.push({ name: m[1], file, index: m.index });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count every occurrence of a symbol across the whole project, then subtract
 * the declaration itself. A symbol used only inside its own file is still used
 * (an exported props type consumed by the component next to it), so excluding
 * the declaring file would report live code as dead.
 */
const unused = [];
for (const { name, file } of symbols) {
  const re = new RegExp('\\b' + escapeRe(name) + '\\b', 'g');
  let total = 0;
  for (const src of texts.values()) {
    const matches = src.match(re);
    if (matches) total += matches.length;
  }
  // One occurrence is the declaration in `export … Name`.
  if (total <= 1) unused.push({ name, file: path.relative(root, file) });
}

/**
 * Second pass: exported *callables* that are mentioned but never invoked.
 *
 * The mention count above is fooled by a local variable that shadows the name.
 * `export function displayValue(...)` looked alive purely because an unrelated
 * `const displayValue = ...` sat in another file; nothing ever called it. A
 * function/const arrow must therefore also appear as `name(` somewhere.
 */
const CALLABLE = /export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?(?:\(|function)|[(<])/g;

const uncalled = [];
for (const file of sourceFiles) {
  const src = texts.get(file);
  let m;
  while ((m = CALLABLE.exec(src))) {
    const name = m[1];
    const callRe = new RegExp('\\b' + escapeRe(name) + '\\s*[(<]', 'g');
    let calls = 0;
    for (const [f, text] of texts) {
      // Skip the declaration itself: `export function name(` would match.
      const body = f === file ? text.replace(m[0], '') : text;
      const found = body.match(callRe);
      if (found) calls += found.length;
    }
    if (calls === 0) uncalled.push({ name, file: path.relative(root, file) });
  }
}

/**
 * Exemptions: symbols whose only purpose is to be consumed by VS Code itself
 * (contribution points, activation, config keys) or by the webview bundler, so
 * no other source file names them.
 */
const EXEMPT = new Set(['activate', 'deactivate']);

const unresolved = unused.filter((u) => !EXEMPT.has(u.name));
const uncalledLive = uncalled.filter((u) => !EXEMPT.has(u.name));

console.log(`exported symbols scanned: ${symbols.length}`);
console.log(`declared but never used: ${unresolved.length}`);
for (const u of unresolved) console.log(`  ! ${u.name}  (${u.file})`);
console.log(`exported callables never invoked: ${uncalledLive.length}`);
for (const u of uncalledLive) console.log(`  ! ${u.name}  (${u.file})`);

process.exit(unresolved.length === 0 && uncalledLive.length === 0 ? 0 : 1);
