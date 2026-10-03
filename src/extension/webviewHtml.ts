// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Webview HTML post-processing.
 *
 * The Vite bundle refers to its assets with relative URLs (`./assets/x.js`),
 * which a VS Code webview cannot resolve: every reference must become a
 * `webview.asWebviewUri()` URL, and the content security policy must allow
 * exactly those resources plus a per-load nonce for the script.
 *
 * The transformation is kept pure — it takes a `toWebviewUri` callback instead
 * of a `vscode.Webview` — so it can be unit tested without the extension host.
 * Getting this wrong produces a silently blank editor, so it is covered by the
 * test suite.
 */

export interface RewriteOptions {
  /** Map a bundle-relative reference onto a webview-loadable URL. */
  toWebviewUri: (assetRef: string) => string;
  /** Nonce stamped onto every script tag and allowed by the CSP. */
  nonce: string;
  /** The `webview.cspSource` value for this webview. */
  cspSource: string;
}

/** Matches `src="./x"` / `href='./x'` and captures the attribute and path. */
const ASSET_RE = /\b(src|href)=("|')([^"']*)\2/gi;

/** Matches an already-absolute URL with a scheme (http:, data:, vscode-webview: …). */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Matches the existing CSP meta tag so it can be replaced, not duplicated. */
const CSP_META_RE = /<meta[^>]+http-equiv=("|')Content-Security-Policy\1[^>]*>/i;

/**
 * Rewrite the built HTML for a VS Code webview.
 *
 * Remote URLs, `data:` URIs, anchors and mailto links are left untouched; only
 * bundle-relative paths are resolved against the extension's output directory.
 */
export function rewriteWebviewHtml(html: string, opts: RewriteOptions): string {
  const { toWebviewUri, nonce, cspSource } = opts;

  let out = html.replace(ASSET_RE, (whole, attr: string, quote: string, ref: string) => {
    // Leave anything with a scheme — and any bare fragment — exactly as it is.
    if (ref.length === 0 || ref.startsWith('#') || HAS_SCHEME_RE.test(ref)) return whole;
    return `${attr}=${quote}${toWebviewUri(ref)}${quote}`;
  });

  // Stamp the nonce onto every script tag. Any pre-existing nonce is replaced
  // so a stale one can never survive into the policy.
  out = out.replace(/<script\b([^>]*)>/gi, (_whole, attrs: string) => {
    const cleaned = attrs.replace(/\snonce=("|')[^"']*\1/gi, '');
    return `<script nonce="${nonce}"${cleaned}>`;
  });

  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    `connect-src ${cspSource}`
  ].join('; ');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  if (CSP_META_RE.test(out)) {
    out = out.replace(CSP_META_RE, meta);
  } else if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (head) => `${head}\n    ${meta}`);
  } else {
    out = `${meta}\n${out}`;
  }
  return out;
}

/** A fresh unpredictable nonce for the per-load content security policy. */
export function makeNonce(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += alphabet.charAt(Math.floor(random() * alphabet.length));
  }
  return out;
}
