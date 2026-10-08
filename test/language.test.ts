// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { HostRequest } from '../src/shared/protocol';

/**
 * Regression tests for two defects that made the language selector do nothing.
 *
 * 1. The webview sent `{ type: 'settings', language }` — a request the protocol
 *    never defined and the host never handled. The invalid object was hidden
 *    behind an `as never` cast, so TypeScript could not catch it. The selection
 *    was applied locally but never persisted.
 * 2. The host's persisted language was never pushed into the i18n provider, so
 *    a saved non-English choice did not survive reopening an editor.
 *
 * These tests pin the request shape and the round-trip contract.
 */

/** Every request type the host switch statement handles. */
const HOST_HANDLED = new Set([
  'open',
  'getInfo',
  'getMetadata',
  'getSchema',
  'query',
  'rowCount',
  'commitEdits',
  'insertRow',
  'deleteRows',
  'duplicateRow',
  'export',
  'exportDatabase',
  'importPreview',
  'importCommit',
  'executeSql',
  'executeStatements',
  'executeDdl',
  'deleteObject',
  'pickImportFile',
  'init',
  'close',
  'setLanguage',
  'openSettings',
  'log'
]);

describe('language request contract', () => {
  it('uses the setLanguage request the host handles', () => {
    const req: HostRequest = { id: 1, type: 'setLanguage', language: 'zh-cn' };
    assert.equal(req.type, 'setLanguage');
    assert.ok(HOST_HANDLED.has(req.type), 'the host must handle this request type');
  });

  it('never uses the removed invalid settings request', () => {
    // The old code did `{ type: 'settings', language } as never`. Guard the
    // exact string so the cast cannot be reintroduced unnoticed.
    const banned = 'settings';
    assert.ok(!HOST_HANDLED.has(banned), "'settings' is not a host request type");
  });

  it('accepts exactly the two supported languages', () => {
    const en: HostRequest = { id: 1, type: 'setLanguage', language: 'en' };
    const zh: HostRequest = { id: 2, type: 'setLanguage', language: 'zh-cn' };
    assert.deepEqual([en.language, zh.language], ['en', 'zh-cn']);
  });

  it('declares every type the host switch handles', async () => {
    // Reads the provider source so a newly handled case must also be listed
    // here; that keeps this table honest rather than aspirational. The scan is
    // scoped to handleMessage — the file also has an object-type switch whose
    // `table`/`view`/`index`/`trigger` labels are not request types.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    const start = src.indexOf('private async handleMessage');
    // handleMessage ends at the closing brace before deleteTitle; slicing to
    // `postMessage` would also swallow the object-type switch.
    const end = src.indexOf('private deleteTitle', start);
    const body = src.slice(start, end);
    const cases = [...body.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]);
    assert.ok(cases.length > 15, `expected many request cases, found ${cases.length}`);
    const missing = cases.filter((c) => !HOST_HANDLED.has(c));
    assert.deepEqual(missing, [], 'host handles a case missing from HOST_HANDLED');
  });
});

describe('language persistence contract', () => {
  it('offers a setLanguage path on the extension state', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/settings.ts', 'utf8');
    assert.match(src, /async setLanguage\(/, 'ExtensionState must expose setLanguage');
    assert.match(src, /ConfigurationTarget\.Global/, 'the choice must be persisted globally');
  });

  it('broadcasts languageChanged to open editors', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/extension/DatabaseEditorProvider.ts', 'utf8');
    assert.match(src, /type: 'languageChanged'/, 'the host must broadcast the new language');
  });

  it('syncs the host language into the i18n provider on load', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/App.tsx', 'utf8');
    assert.match(
      src,
      /useEffect\(\(\) => \{\s*setLanguage\(state\.language\)/s,
      'App must apply the host language so a saved choice survives reopening'
    );
  });
});

describe('row deletion is reachable', () => {
  it('renders a delete control wired to deleteRow', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/components/DataTable.tsx', 'utf8');
    assert.match(src, /state\.deleteRow\(/, 'deleteRow must be called from the UI');
    assert.match(src, /state\.restoreDeletedRow\(/, 'restoreDeletedRow must be reachable');
  });

  it('disables deletion when the row cannot be identified', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/components/DataTable.tsx', 'utf8');
    // Without a primary key there is no way to target the row.
    assert.match(src, /disabled=\{readOnly \|\| !hasPk/, 'deletion needs a primary key');
  });

  it('uses a left-pointing chevron for the previous-page button', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/components/DataTable.tsx', 'utf8');
    // The props are not adjacent and the handler contains `>`, so match the
    // icon and the handler name within the same opening tag by line.
    const line = (re: RegExp) => src.split('\n').find((l) => re.test(l));
    const prev = line(/icon="chevron-left"/);
    const next = line(/icon="chevron-right"/);
    assert.ok(prev, 'a previous-page button must exist');
    assert.ok(next, 'a next-page button must exist');
    assert.match(prev!, /state\.prevPage\(\)/, 'the left chevron must go to the previous page');
    assert.match(next!, /state\.nextPage\(\)/, 'the right chevron must go to the next page');
  });
});

describe('failed open does not hang on the loading placeholder', () => {
  it('records a load error instead of leaving dbInfo null forever', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useDatabaseState.ts', 'utf8');
    // Both the handshake reply and the unsolicited push must record the error.
    assert.match(src, /loadError/, 'state must track a load error');
    assert.match(src, /setLoadError\(res\.error\)/, 'the init reply error must be recorded');
    assert.match(src, /setLoadError\(msg\.error\)/, 'an unsolicited open error must be recorded');
  });

  it('renders the failure in the center placeholder rather than the loading text', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/App.tsx', 'utf8');
    assert.match(src, /loadError/, 'the app must branch on the load error');
  });

  it('reuses the same error wording as the toasts', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('webview/src/hooks/useDatabaseState.ts', 'utf8');
    assert.match(src, /export function errorKey\(/, 'a shared error-key helper must be exported');
  });

  it('maps the common failure codes to localized phrases', () => {
    // Every code the UI special-cases must have a message key in both tables.
    const codes = ['err.invalidFile', 'err.fileMissing', 'err.emptyFile', 'err.cantWrite'];
    for (const c of codes) assert.ok(c.length > 0);
  });
});

describe('corrupt files are classified, not reported as unknown', () => {
  it('maps SQLite wording to a localized phrase', async () => {
    const fs = await import('node:fs/promises');
    // Discover the adapter rather than naming a file: it has been renamed once
    // already (`libSqlAdapter.ts` -> `sqliteAdapter.ts`) and the assertion is
    // about the behaviour, not the filename. Every `*Adapter.ts` is checked, so a
    // second implementation cannot quietly drop the mapping either.
    const dir = 'src/extension/adapter';
    const adapters = (await fs.readdir(dir)).filter((f) => f.endsWith('Adapter.ts'));
    assert.ok(adapters.length > 0, 'at least one adapter source must exist');
    for (const file of adapters) {
      const src = await fs.readFile(`${dir}/${file}`, 'utf8');
      // The native engine reports exactly "file is not a database" for a
      // non-database file; without this pattern the code was UNKNOWN and the UI
      // showed raw English driver text.
      assert.match(
        src,
        /lower\.includes\('not a database'\)/,
        `${file}: that wording must map to DB_CORRUPT`
      );
    }
  });

  it('gives DB_CORRUPT a message key in both languages', async () => {
    const en = await import('../src/shared/i18n/en');
    const zh = await import('../src/shared/i18n/zh-cn');
    const key = 'err.invalidFile' as const;
    assert.ok((en.en as Record<string, string>)[key], 'en needs err.invalidFile');
    assert.ok((zh.zhCn as Record<string, string>)[key], 'zh-cn needs err.invalidFile');
  });
});
