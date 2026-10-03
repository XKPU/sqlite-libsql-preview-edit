/**
 * Key-parity guard for the message tables.
 *
 * `en.ts` and `zh-cn.ts` are two independent `as const` objects, so nothing
 * forces them to agree. A key present in one and missing from the other means a
 * hardcoded English string leaks into the Chinese UI (or vice versa).
 *
 * Two complementary checks live here, because neither alone is sufficient:
 *
 * - The type-level check below breaks the *build* the moment the key sets
 *   diverge, so it cannot be forgotten and needs no test run.
 * - `findParityProblems` reports the *specific* offending keys at runtime, so a
 *   failure says which key to add rather than only that the tuple mismatched.
 *
 * Kept as plain TypeScript (no JSX, no React) so the Node test suite can import
 * it directly.
 */
import { en, zhCn } from '../../../src/shared/i18n';
import type { MessageKey } from '../../../src/shared/i18n';

type _CheckNoExtraZhKey = keyof typeof zhCn extends MessageKey ? true : never;
type _CheckNoMissingZhKey = MessageKey extends keyof typeof zhCn ? true : never;

/**
 * Compile-time parity assertion.
 *
 * Both members resolve to `true` only when the key sets match; otherwise the
 * assignment fails to type-check and the build stops. It is exported so
 * `noUnusedLocals` accepts it and so the test suite can assert on it.
 */
export const I18N_KEY_PARITY: readonly [_CheckNoExtraZhKey, _CheckNoMissingZhKey] = [true, true];

/** The two tables plus the reference table's key type. */
export interface ParityProblem {
  /** Keys the reference table has and the other table lacks. */
  missing: string[];
  /** Keys the other table has that the reference table lacks. */
  extra: string[];
}

/**
 * Compute key differences between two message tables.
 *
 * Returns empty arrays when the tables agree, so callers can assert on the
 * result without knowing the key names.
 */
export function findParityProblems(
  reference: Record<string, string>,
  other: Record<string, string>
): ParityProblem {
  const referenceKeys = new Set(Object.keys(reference));
  const otherKeys = new Set(Object.keys(other));
  return {
    missing: [...referenceKeys].filter((k) => !otherKeys.has(k)).sort(),
    extra: [...otherKeys].filter((k) => !referenceKeys.has(k)).sort()
  };
}

/** Convenience: the English/Chinese tables, ready for `findParityProblems`. */
export function checkLanguageParity(): ParityProblem {
  return findParityProblems(en, zhCn);
}
