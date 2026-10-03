// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host-side i18n: a small observable wrapper over the shared lookup logic.
 *
 * The tables and the lookup/fallback/placeholder rules live in
 * `src/shared/i18n/`, which the webview uses too. Only the parts that are
 * host-specific remain here: remembering the active language and notifying
 * listeners when it changes.
 */
import { translate } from '../../shared/i18n';
import type { Language, MessageKey, MessageVars } from '../../shared/i18n';

export type { Language, MessageKey };
export { en, zhCn, resolveLanguage } from '../../shared/i18n';

export class I18n {
  private _listeners = new Set<(lang: Language) => void>();
  private _language: Language;

  constructor(language: Language = 'en') {
    this._language = language;
  }

  setLanguage(language: Language): void {
    if (language === this._language) return;
    this._language = language;
    this._listeners.forEach((l) => l(language));
  }

  get language(): Language {
    return this._language;
  }

  onChange(fn: (lang: Language) => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Look up a message and substitute `{name}` placeholders. */
  t(key: MessageKey, vars?: MessageVars): string {
    return translate(key, this._language, vars);
  }
}
