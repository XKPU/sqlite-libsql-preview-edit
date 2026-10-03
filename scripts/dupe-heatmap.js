// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Duplication heatmap.
 *
 * Slides a window over every source file; any window whose normalized skeleton
 * appears more than once is "duplicated". Reports, per file, how many lines
 * participate in duplicated blocks, so effort goes to the worst offenders.
 *
 * Run: node scripts/dupe-heatmap.js [windowSize]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const WINDOW = Number(process.argv[2] || 6);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(f);
  }
  return out;
}

const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'webview', 'src'))];

function lines(src) {
  return src
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    // Strip doc-comment bodies: prose that repeats between related types is not
    // code duplication and would drown the real signal.
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith('*') &&
        !l.startsWith('/*') &&
        !l.startsWith('*/')
    );
}

function skeleton(line) {
  return line
    .replace(/'((?:[^'\\]|\\.)*)'/g, "'S'")
    .replace(/"((?:[^"\\]|\\.)*)"/g, '"S"')
    .replace(/`((?:[^`\\]|\\.)*)`/g, '`S`')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/\b[A-Za-z_$][\w$]*\b/g, 'I');
}

/** Skip windows made of import lists, type imports, or bare punctuation. */
function usable(win) {
  const text = win.join('\n');
  if (/^import\b/.test(text) || /^\}? from '/.test(win[0])) return false;
  // A window that is only a JSX tag list or a bare type union is structure, not
  // logic; it would flag every component as "duplicated".
  if (/^[A-Za-z]+Props\b/.test(win[0])) return false;
  const codeChars = text.replace(/[^\w]/g, '').length;
  const distinct = new Set(win.map(skeleton)).size;
  // Require at least one statement/expression line, not just markup fragments.
  const hasLogic = win.some((l) => /[=(){}\[\]]|=>|\breturn\b|\bif\b|\bconst\b|\bawait\b/.test(l));
  return hasLogic && codeChars > WINDOW * 5 && distinct >= Math.max(2, Math.floor(WINDOW / 2));
}

const perFile = new Map();
const seen = new Map();

for (const file of files) {
  const ls = lines(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(root, file);
  const hot = new Set();
  for (let i = 0; i + WINDOW <= ls.length; i++) {
    const win = ls.slice(i, i + WINDOW);
    if (!usable(win)) continue;
    const key = win.map(skeleton).join('\n');
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(rel);
    // Mark every line of a window that appears in more than one place.
    seen.get(key).size;
    hot.add(i);
  }
  perFile.set(rel, { lines: ls.length, windows: hot });
}

// Second pass: only count windows that really collide.
const result = [];
for (const file of files) {
  const ls = lines(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(root, file);
  let dup = 0;
  for (let i = 0; i + WINDOW <= ls.length; i++) {
    const win = ls.slice(i, i + WINDOW);
    if (!usable(win)) continue;
    const key = win.map(skeleton).join('\n');
    const sites = seen.get(key);
    if (sites && sites.size > 1) dup++;
  }
  result.push({ rel, lines: ls.length, dup });
}

result.sort((a, b) => b.dup - a.dup);
console.log(`window=${WINDOW} lines | duplicated windows per file (top 25)\n`);
console.log('  dup  total  ratio  file');
for (const r of result.slice(0, 25)) {
  if (r.dup === 0) continue;
  const ratio = ((r.dup / Math.max(1, r.lines)) * 100).toFixed(0);
  console.log(`  ${String(r.dup).padStart(3)}  ${String(r.lines).padStart(5)}  ${String(ratio).padStart(4)}%  ${r.rel}`);
}
const totalDup = result.reduce((s, r) => s + r.dup, 0);
const totalLines = result.reduce((s, r) => s + r.lines, 0);
console.log(`\n  TOTAL ${totalDup} duplicated windows / ${totalLines} non-blank lines`);

/**
 * Gate mode: fail when duplication exceeds the ceiling.
 *
 * `WINDOW=8` is used for the gate because a six-line window flags shared
 * primitives (a `Modal` shell, a toolbar button) as duplicates, which is the
 * intended outcome of the refactor rather than a defect. An eight-line window
 * only matches substantial repeated logic.
 *
 * Run: node scripts/dupe-heatmap.js 8 --max=5
 */
const maxArg = process.argv.find((a) => a.startsWith('--max='));
if (maxArg) {
  const max = Number(maxArg.split('=')[1]);
  const worst = result[0];
  const ok = totalDup <= max;
  console.log(
    `\n  gate: ${totalDup} duplicated windows (limit ${max}) -> ${ok ? 'PASS' : 'FAIL'}` +
      (worst ? `\n  worst: ${worst.rel} (${worst.dup})` : '')
  );
  process.exit(ok ? 0 : 1);
}
