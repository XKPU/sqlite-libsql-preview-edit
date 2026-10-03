// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Language } from '../../../src/shared/protocol';
import { translate } from '../../../src/shared/i18n';
import type { MessageKey, MessageVars } from '../../../src/shared/i18n';

// The compile-time key-parity guard lives in `./parity.ts`, which has no JSX so
// the Node test suite can import it directly; see that file for the rationale.

export interface I18nContextValue {
  /** Translate a key, replacing `{name}` tokens. */
  t: (key: MessageKey, vars?: MessageVars) => string;
  /** The current UI language. */
  language: Language;
  /** Change the UI language (does not notify the host — see useWebview). */
  setLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nContextValue = I18nContext;

export const I18nProvider: React.FC<{ children: React.ReactNode; defaultLanguage?: Language }> = (props) => {
  const { children, defaultLanguage = 'en' } = props;
  const [language, setLanguage] = useState<Language>(defaultLanguage);

  // `translate` carries the lookup, fallback and placeholder rules and is
  // shared with the extension host, so both sides render a key identically.
  const t = useCallback(
    (key: MessageKey, vars?: MessageVars): string => translate(key, language, vars),
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ t, language, setLanguage }),
    [t, language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return ctx;
}

export type { MessageKey, Language };
