#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

// Test runner: compiles TypeScript tests with a dedicated tsconfig, then runs
// them with the Node.js built-in `node --test` runner.
//
// SECURITY: every child process is spawned with `execFileSync` and an argument
// array, never through a shell. Shell-interpolated commands are unsafe here
// because this repository's own path contains `&` and a space, and because a
// path may contain characters the shell treats specially (`&`, `%`, `$`, `"`,
// `` ` ``). Passing an argument array means the OS executes the binary directly
// and no shell ever parses the path, so those characters cannot change the
// meaning of the command.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out', 'test');
const tscPath = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

/** Run a Node script directly, without a shell. */
function runNode(args, options = {}) {
  execFileSync(process.execPath, args, { cwd: root, ...options });
}

fs.mkdirSync(outDir, { recursive: true });

// Compile the test files.
try {
  runNode([tscPath, '-p', './tsconfig.test.json'], { stdio: 'inherit' });
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

// Run each compiled test file with the built-in test runner.
let failed = false;
for (const file of testFiles) {
  try {
    runNode(['--test', file], { stdio: 'inherit' });
  } catch {
    failed = true;
  }
}

// Exercise the compiled extension host's message router against the exact
// failure that was reported ("Unhandled message type: log"). The TypeScript
// tests assert on intent; this drives the real compiled code through a fake
// VS Code API, so it fails if the shipped logic regresses.
try {
  // `compile:extension` is just `tsc -p ./tsconfig.extension.json`, so call tsc
  // directly rather than through npm (no shell, no npm.cmd resolution problem).
  runNode([tscPath, '-p', './tsconfig.extension.json'], { stdio: 'ignore' });
  runNode([path.join(__dirname, 'verify-message-router.js')], { stdio: 'inherit' });
} catch {
  console.error('Compiled message-router verification failed.');
  failed = true;
}

process.exit(failed ? 1 : 0);
