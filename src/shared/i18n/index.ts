// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Runtime i18n shared by the extension host and the webview.
 *
 * The two language tables live next to this file and are the single source of
 * truth for every user-visible string. This module holds the *logic* that turns
 * a key into a rendered string, so the host and the webview cannot disagree
 * about how lookups, fallbacks, or placeholders work.
 *
 * That was previously duplicated: the host's `I18n` class and the webview's
 * React provider each carried their own table lookup, their own `{token}`
 * substitution loop, and their own fallback chain — and the chains had already
 * drifted, so a key missing from both tables rendered `undefined` in the
 * webview but the key name in the host.
 */
import type { Language } from '../protocol';
import { en, type MessageKey } from './en';
import { zhCn } from './zh-cn';

export { en, zhCn };
export type { MessageKey, Language };

/**
 * Values substituted into `{token}` placeholders.
 *
 * `undefined` and `null` are accepted so callers can pass optional fields
 * directly; such tokens are left untouched rather than rendering "undefined".
 */
export type MessageVars = Record<string, string | number | undefined | null>;

/**
 * The two tables behind one index signature.
 *
 * `en` is `as const` so `MessageKey` can be derived from it; widening here is
 * what lets a language be chosen at runtime.
 */
const tables: Record<Language, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  'zh-cn': zhCn as unknown as Record<string, string>
};

/** Substitute `{token}` occurrences in a message string. */
export function interpolate(msg: string, vars?: MessageVars): string {
  if (!vars) return msg;
  let out = msg;
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null) continue;
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/**
 * Resolve a message key to text in one language.
 *
 * Fallback order is Chinese (the requested language) → English → the key
 * itself. The last step matters: rendering `unknown.key` makes a missing
 * translation obvious in the UI, whereas `undefined` looks like a rendering
 * bug and is easy to ship.
 */
export function translate(key: MessageKey, language: Language, vars?: MessageVars): string {
  const msg = tables[language][key] ?? tables.en[key] ?? String(key);
  return interpolate(msg, vars);
}

/**
 * Resolve the user's language setting (`auto` / `en` / `zh-cn`) to a concrete
 * language, given the VS Code display language.
 */
export function resolveLanguage(
  setting: 'auto' | 'en' | 'zh-cn',
  vscodeLanguage: string
): Language {
  if (setting === 'en') return 'en';
  if (setting === 'zh-cn') return 'zh-cn';
  return vscodeLanguage.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
}
