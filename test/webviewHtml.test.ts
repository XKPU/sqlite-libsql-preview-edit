// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { makeNonce, rewriteWebviewHtml } from '../src/extension/webviewHtml';

/**
 * These tests guard the single most failure-prone step of the editor: if the
 * built bundle's asset URLs are not rewritten for the webview, or the CSP is
 * wrong, VS Code shows a permanently blank editor with no visible error.
 */

/** The shape of the HTML that Vite actually emits. */
const VITE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline';" />
    <title>SQLite/LibSQL Preview&amp;Edit</title>
    <script type="module" crossorigin src="./assets/index.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const NONCE = 'abc123NONCE';
const CSP_SOURCE = 'vscode-webview://abc';

function rewrite(html: string): string {
  return rewriteWebviewHtml(html, {
    toWebviewUri: (ref) => `WEBVIEW_URI(${ref})`,
    nonce: NONCE,
    cspSource: CSP_SOURCE
  });
}

describe('rewriteWebviewHtml', () => {
  it('rewrites the script and stylesheet references', () => {
    const out = rewrite(VITE_HTML);
    assert.ok(out.includes('src="WEBVIEW_URI(./assets/index.js)"'), out);
    assert.ok(out.includes('href="WEBVIEW_URI(./assets/index.css)"'), out);
    // The original relative references must be gone.
    assert.equal(out.includes('src="./assets/index.js"'), false);
    assert.equal(out.includes('href="./assets/index.css"'), false);
  });

  it('stamps the nonce on every script tag', () => {
    const out = rewrite(VITE_HTML);
    assert.ok(out.includes(`<script nonce="${NONCE}"`), out);
  });

  it('replaces an existing CSP meta instead of adding a second one', () => {
    const out = rewrite(VITE_HTML);
    const count = (out.match(/Content-Security-Policy/g) ?? []).length;
    assert.equal(count, 1, 'exactly one CSP meta tag must remain');
  });

  it('builds a CSP that allows the nonce and the webview source', () => {
    const out = rewrite(VITE_HTML);
    assert.ok(out.includes(`script-src 'nonce-${NONCE}'`), out);
    assert.ok(out.includes(`style-src ${CSP_SOURCE} 'unsafe-inline'`), out);
    assert.ok(out.includes("default-src 'none'"), out);
  });

  it('inserts a CSP when the document has none', () => {
    const out = rewrite('<html><head><title>t</title></head><body></body></html>');
    assert.ok(out.includes('Content-Security-Policy'), out);
    assert.equal((out.match(/Content-Security-Policy/g) ?? []).length, 1);
  });

  it('leaves absolute and non-resource references untouched', () => {
    const html =
      '<a href="https://example.com">e</a>' +
      '<img src="data:image/png;base64,AAA">' +
      '<a href="#anchor">a</a>' +
      '<script src="vscode-webview://x/y.js"></script>';
    const out = rewrite(html);
    assert.ok(out.includes('href="https://example.com"'), out);
    assert.ok(out.includes('src="data:image/png;base64,AAA"'), out);
    assert.ok(out.includes('href="#anchor"'), out);
    assert.ok(out.includes('src="vscode-webview://x/y.js"'), out);
  });

  it('replaces a stale nonce rather than keeping two', () => {
    const html = '<script nonce="OLDSHOULDGO" src="./a.js"></script>';
    const out = rewrite(html);
    assert.equal(out.includes('OLDSHOULDGO'), false, out);
    assert.ok(out.includes(`nonce="${NONCE}"`), out);
    assert.equal((out.match(/nonce=/g) ?? []).length, 1, out);
  });

  it('is idempotent for the nonce and CSP', () => {
    const once = rewrite(VITE_HTML);
    const twice = rewrite(once);
    assert.equal((twice.match(/nonce=/g) ?? []).length, 1, twice);
    assert.equal((twice.match(/Content-Security-Policy/g) ?? []).length, 1, twice);
  });
});

describe('makeNonce', () => {
  it('returns 32 characters from the allowed alphabet', () => {
    const nonce = makeNonce();
    assert.equal(nonce.length, 32);
    assert.match(nonce, /^[A-Za-z0-9]{32}$/);
  });

  it('is deterministic for a fixed random source', () => {
    assert.equal(makeNonce(() => 0), 'A'.repeat(32));
  });

  it('produces different values across calls', () => {
    assert.notEqual(makeNonce(), makeNonce());
  });
});
