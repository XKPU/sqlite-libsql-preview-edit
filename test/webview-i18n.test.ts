// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { en } from '../src/shared/i18n/en';
import { zhCn } from '../src/shared/i18n/zh-cn';
import {
  checkLanguageParity,
  findParityProblems,
  I18N_KEY_PARITY
} from '../webview/src/i18n/parity';

/**
 * The webview ships its own message tables, separate from the extension host.
 *
 * `webview/src/i18n/parity.ts` breaks the build when the two languages diverge,
 * and these tests are the runtime half: they name the offending keys, so a
 * failure says which phrase to add rather than only that a tuple mismatched. A
 * missing Chinese phrase shows an English string in the Chinese UI, which is
 * exactly the "no hardcoded strings" rule this guards.
 */
describe('webview i18n tables', () => {
  it('en and zh-cn define exactly the same keys', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCn).sort();
    assert.deepEqual(zhKeys, enKeys);
  });

  it('reports the exact keys that diverge, not just that they do', () => {
    // The runtime reporter must agree with the raw key comparison above.
    const problems = checkLanguageParity();
    assert.deepEqual(problems.missing, [], 'zh-cn is missing keys');
    assert.deepEqual(problems.extra, [], 'zh-cn has keys en does not');
  });

  it('detects a missing and an extra key in a synthetic table', () => {
    // Guards the guard: if `findParityProblems` were broken, the assertion
    // above would pass vacuously.
    const problems = findParityProblems({ a: '1', b: '2' }, { a: '1', c: '3' });
    assert.deepEqual(problems.missing, ['b']);
    assert.deepEqual(problems.extra, ['c']);
  });

  it('reports no problems for identical tables', () => {
    assert.deepEqual(findParityProblems({ a: '1' }, { a: '1' }), { missing: [], extra: [] });
  });

  it('asserts the compile-time parity tuple resolved to true', () => {
    // `I18N_KEY_PARITY` can only be `[true, true]` if the key sets match — the
    // type system rejects anything else — so this both documents the guard and
    // keeps it referenced rather than an inert export.
    assert.deepEqual([...I18N_KEY_PARITY], [true, true]);
  });

  it('has no duplicate keys (an object literal would silently drop one)', () => {
    // Duplicates cannot survive `as const` object literals in TS, but the
    // counts are asserted so a future refactor to a different shape is caught.
    assert.equal(Object.keys(en).length, new Set(Object.keys(en)).size);
    assert.equal(Object.keys(zhCn).length, new Set(Object.keys(zhCn)).size);
  });

  it('maps no key to an empty string', () => {
    for (const [k, v] of Object.entries(en)) assert.ok(v.length > 0, `en.${k} is empty`);
    for (const [k, v] of Object.entries(zhCn)) assert.ok(v.length > 0, `zh-cn.${k} is empty`);
  });

  it('keeps the same {placeholder} tokens in both languages', () => {
    // A translated string that drops `{name}` would render a broken message.
    const tokens = (s: string): string[] => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
    for (const [k, v] of Object.entries(en)) {
      const zh = (zhCn as Record<string, string>)[k];
      assert.deepEqual(tokens(zh), tokens(v), `placeholder mismatch for ${k}`);
    }
  });

  it('still translates the Chinese phrases instead of copying English', () => {
    // A handful of keys are genuinely identical across languages (product names
    // such as "SQLite"); the error/warning phrases are not, so at least one
    // must differ or the zh table has been mis-filled with English.
    const differing = Object.keys(en).filter(
      (k) => (en as Record<string, string>)[k] !== (zhCn as Record<string, string>)[k]
    );
    assert.ok(differing.length > 100, `only ${differing.length} keys differ — likely untranslated`);
  });
});

describe('webview error localization coverage', () => {
  /**
   * The error phrases live under `err.*` / `warn.*`. They are asserted to exist
   * because the state hook routes structured error codes through them; if one
   * is renamed away, host errors would fall back to English driver text.
   */
  const REQUIRED = [
    'err.invalidFile',
    'err.fileMissing',
    'err.emptyFile',
    'err.cantWrite',
    'err.txFailed',
    'err.confirmCancelled',
    'err.copyFailed',
    'warn.readOnly',
    'warn.noSql',
    'warn.selectOnly',
    'warn.nothingToExport'
  ];

  it('defines every phrase the UI can surface', () => {
    for (const key of REQUIRED) {
      assert.ok(key in en, `en is missing ${key}`);
      assert.ok(key in zhCn, `zh-cn is missing ${key}`);
    }
  });
});
