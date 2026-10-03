#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

// Test runner: compiles TypeScript tests with a dedicated tsconfig, then runs
// them with the Node.js built-in `node --test` runner.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out', 'test');
const tscPath = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

fs.mkdirSync(outDir, { recursive: true });

// Compile the test files.
try {
  execSync(`node ${JSON.stringify(tscPath)} -p ./tsconfig.test.json`, {
    cwd: root,
    stdio: 'inherit'
  });
} catch {
  console.error('Test compilation failed.');
  process.exit(1);
}

// Find all compiled .js test files.
const testFiles = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.test.js')) testFiles.push(full);
  }
}
walk(outDir);

if (testFiles.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

// Run all test files in one node --test invocation.
let failed = false;
for (const file of testFiles) {
  try {
    execSync(`node --test ${JSON.stringify(file)}`, { cwd: root, stdio: 'inherit' });
  } catch {
    failed = true;
  }
}

// Exercise the compiled extension host's message router against the exact
// failure that was reported ("Unhandled message type: log"). The TypeScript
// tests assert on intent; this drives the real compiled code through a fake
// VS Code API, so it fails if the shipped logic regresses.
try {
  execSync('npm run compile:extension', { cwd: root, stdio: 'ignore' });
  execSync(`node ${JSON.stringify(path.join(__dirname, 'verify-message-router.js'))}`, {
    cwd: root,
    stdio: 'inherit'
  });
} catch {
  console.error('Compiled message-router verification failed.');
  failed = true;
}

process.exit(failed ? 1 : 0);
