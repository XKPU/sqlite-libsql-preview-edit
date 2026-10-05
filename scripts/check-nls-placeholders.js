#!/usr/bin/env node
/*
 * Verifies that every %placeholder% referenced by package.json resolves in the
 * package.nls.json and package.nls.zh-cn.json localization bundles.
 *
 * Read-only: reports mismatches, never rewrites the manifests.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const nlsPaths = [
  path.join(root, 'package.nls.json'),
  path.join(root, 'package.nls.zh-cn.json')
];

const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);

/** Collect every %key% placeholder appearing anywhere in package.json. */
function collectPlaceholders(text) {
  const found = new Map();
  const re = /%([^%\s]+)%/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    if (!found.has(key)) found.set(key, 0);
    found.set(key, found.get(key) + 1);
  }
  return found;
}

const referenced = collectPlaceholders(pkgRaw);
const bundled = new Set();
for (const file of nlsPaths) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(json)) bundled.add(key);
  // Also record which bundle defines each key (for the report below).
  json.__keys = Object.keys(json);
}

const nls = nlsPaths.map((file) => ({
  file: path.basename(file),
  keys: new Set(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))))
}));

console.log('package.json:', path.relative(root, pkgPath));
console.log('Referenced placeholders:', referenced.size);
for (const [key, count] of [...referenced].sort()) {
  const perBundle = nls
    .map((b) => `${b.file}=${b.keys.has(key) ? 'OK' : 'MISSING'}`)
    .join('  ');
  console.log(`  %${key}%  x${count}  ${perBundle}`);
}

let mismatches = 0;
for (const [key] of referenced) {
  for (const bundle of nls) {
    if (!bundle.keys.has(key)) {
      mismatches++;
      console.log(`MISMATCH: %${key}% referenced by package.json is missing from ${bundle.file}`);
    }
  }
}

// Orphaned keys: defined in an nls bundle but never referenced by package.json.
for (const bundle of nls) {
  for (const key of bundle.keys) {
    if (!referenced.has(key)) {
      console.log(`ORPHAN (not referenced by package.json): "${key}" in ${bundle.file}`);
    }
  }
}

// Consistency between the two bundles (they should define the same key set).
const [en, zh] = nls;
for (const key of en.keys) {
  if (!zh.keys.has(key)) console.log(`BUNDLE GAP: "${key}" present in ${en.file} but missing from ${zh.file}`);
}
for (const key of zh.keys) {
  if (!en.keys.has(key)) console.log(`BUNDLE GAP: "${key}" present in ${zh.file} but missing from ${en.file}`);
}

console.log(mismatches === 0 ? 'RESULT: all placeholders resolve in both bundles' : `RESULT: ${mismatches} unresolved placeholder(s)`);
process.exitCode = mismatches === 0 ? 0 : 1;

// Keep the referenced set reachable for callers that import this file.
module.exports = { collectPlaceholders, referenced, bundled, pkg };
