/**
 * Version-skew rules shared by the extension host and the webview.
 *
 * VS Code loads the extension host and the webview bundle independently.
 * Installing a new `.vsix` replaces both on disk, but a window that is already
 * open keeps its extension host in memory: the webview picks up the new bundle
 * as soon as it reloads, while the host keeps running the build it started
 * with. The two sides can therefore disagree about the wire contract.
 *
 * That mismatch used to be invisible. The old host answered a message it did
 * not recognise with `{ id: 0, type: 'error', … }`, and because id 0 cannot
 * match a pending request the webview routed that reply to its load-error path:
 * a single diagnostic `log` line surfaced as a fatal database error.
 *
 * These helpers make the skew explicit and give it one safe direction. They are
 * pure so both sides share exactly the same rules and both can be unit tested.
 */

import { PROTOCOL_VERSION } from './protocol';

/**
 * What to do with an outbound diagnostic, given the host's known version.
 *
 * - `buffer` — the host has not identified itself yet.
 * - `send`   — the host speaks this build's contract.
 * - `drop`   — the host speaks a different contract, so the message may not
 *              exist there; silently dropping a log is always better than
 *              risking a fatal error in the UI.
 */
export type LogDecision = 'buffer' | 'send' | 'drop';

/**
 * Decide how to handle an outbound diagnostic.
 *
 * `null` means the host's version is not known yet, which is the state during
 * startup: nothing is sent until the host's `ready` snapshot arrives.
 */
export function decideLog(hostVersion: number | null): LogDecision {
  if (hostVersion === null) return 'buffer';
  return hostVersion === PROTOCOL_VERSION ? 'send' : 'drop';
}

/**
 * Normalise the version a host reported.
 *
 * A host built before the field existed omits it; it is treated as version 1 so
 * the webview recognises it as a real, older build rather than an unknown one.
 */
export function reportedHostVersion(protocolVersion: number | undefined): number {
  return protocolVersion ?? 1;
}

/**
 * Whether this host build can serve a request from a sender at `senderVersion`.
 *
 * An absent version is accepted: a webview from an older build predates the
 * field, and refusing it would break the working "new host, older webview"
 * case. Only an explicitly different version is rejected, which is the case
 * worth reporting because reloading the window fixes it.
 */
export function isCompatibleSender(senderVersion: number | undefined): boolean {
  return senderVersion === undefined || senderVersion === PROTOCOL_VERSION;
}
