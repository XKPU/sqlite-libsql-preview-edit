#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

// Removes build outputs so compile is always from scratch.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dirs = ['out', 'dist'];
for (const dir of dirs) {
  const p = path.join(root, dir);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log('cleaned', dir);
  }
}
