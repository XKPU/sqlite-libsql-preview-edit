import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en, zhCn } from '../src/shared/i18n';
import { I18n } from '../src/extension/i18n';
import { resolveLanguage, translate } from '../src/shared/i18n';

describe('i18n tables', () => {
  it('en and zh-cn have the same keys', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCn).sort();
    assert.deepEqual(zhKeys, enKeys);
  });

  it('no key maps to an empty string', () => {
    for (const [k, v] of Object.entries(en)) {
      assert.ok(v.length > 0, `en.${k} is empty`);
    }
    for (const [k, v] of Object.entries(zhCn)) {
      assert.ok(v.length > 0, `zh-cn.${k} is empty`);
    }
  });

  it('every message is a string', () => {
    for (const v of Object.values(en)) assert.equal(typeof v, 'string');
    for (const v of Object.values(zhCn)) assert.equal(typeof v, 'string');
  });

  it('has exactly one place a table may be declared', () => {
    // The tables used to exist as four standalone copies (host + webview, each
    // in two languages), which duplicated every key verbatim and let them
    // drift. The copies are gone; this pins that no module re-declares a table,
    // so a reintroduced copy fails here instead of silently diverging.
    //
    // Only a declaration counts — `src/shared/i18n/index.ts` legitimately
    // imports the tables to re-export them, which is not duplication.
    const tables = ['en.ts', 'zh-cn.ts'];
    const dirs = ['src/shared/i18n', 'src/extension/i18n', 'webview/src/i18n'];
    for (const dir of dirs) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        const declaresTable = /export\s+const\s+(en|zhCn)\s*=\s*\{/.test(src);
        const allowed = dir === 'src/shared/i18n' && tables.includes(file);
        assert.equal(
          declaresTable,
          allowed,
          `${dir}/${file}: a message table may only be declared in src/shared/i18n/{en,zh-cn}.ts`
        );
      }
    }
  });
});

describe('translate (shared by host and webview)', () => {
  it('returns the message for the requested language', () => {
    assert.equal(translate('cmd.open', 'en'), en['cmd.open']);
    assert.equal(translate('cmd.open', 'zh-cn'), zhCn['cmd.open']);
  });

  it('falls back to the key when it exists in neither table', () => {
    // A missing key must be visible as its own name, not as `undefined`.
    assert.equal(translate('missing.key.xyz' as never, 'en'), 'missing.key.xyz');
  });

  it('substitutes placeholders and ignores null/undefined ones', () => {
    assert.equal(translate('msg.opened', 'en', { path: '/tmp/a.db' }), 'Opened /tmp/a.db');
    const raw = en['msg.opened'];
    assert.equal(translate('msg.opened', 'en', { path: undefined }), raw);
  });

  it('renders the key rather than "undefined" for an unknown key', () => {
    // The host used to fall back to the key name while the webview rendered
    // `undefined`; sharing one implementation removed that divergence.
    const out = translate('no.such.key' as never, 'zh-cn');
    assert.equal(out, 'no.such.key');
    assert.notEqual(out, 'undefined');
  });
});

describe('I18n', () => {
  it('returns the en message for en', () => {
    const i = new I18n('en');
    assert.equal(i.t('cmd.open'), en['cmd.open']);
  });

  it('returns the zh-cn message for zh-cn', () => {
    const i = new I18n('zh-cn');
    assert.equal(i.t('cmd.open'), zhCn['cmd.open']);
  });

  it('substitutes placeholders', () => {
    const i = new I18n('en');
    assert.equal(i.t('confirm.deleteTable.title', { name: 'users' }), 'Delete table "users"?');
  });

  it('fires onChange listeners when language changes', () => {
    const i = new I18n('en');
    let notified = false;
    i.onChange(() => {
      notified = true;
    });
    i.setLanguage('zh-cn');
    assert.equal(notified, true);
    assert.equal(i.language, 'zh-cn');
  });

  it('does not fire onChange for the same language', () => {
    const i = new I18n('en');
    let count = 0;
    i.onChange(() => count++);
    i.setLanguage('en');
    assert.equal(count, 0);
  });
});

describe('resolveLanguage', () => {
  it('returns en when setting is en', () => {
    assert.equal(resolveLanguage('en', 'zh-cn'), 'en');
  });

  it('returns zh-cn when setting is zh-cn', () => {
    assert.equal(resolveLanguage('zh-cn', 'en'), 'zh-cn');
  });

  it('returns zh-cn when auto and vscode is zh', () => {
    assert.equal(resolveLanguage('auto', 'zh-cn'), 'zh-cn');
  });

  it('returns en when auto and vscode is not zh', () => {
    assert.equal(resolveLanguage('auto', 'en'), 'en');
  });

  it('is case-insensitive on vscode language', () => {
    assert.equal(resolveLanguage('auto', 'ZH-CN'), 'zh-cn');
  });
});
