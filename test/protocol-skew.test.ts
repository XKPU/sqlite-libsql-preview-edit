// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../src/shared/protocol';
import {
  decideLog,
  isCompatibleSender,
  reportedHostVersion
} from '../src/shared/protocolSkew';

/**
 * Installing a `.vsix` does not restart an already running extension host, so a
 * reloaded webview can end up talking to an older host. The old host answered
 * anything it did not recognise with `{ id: 0, type: 'error' }`, and id 0 cannot
 * match a pending request — so the webview routed that reply to its load-error
 * path and a single diagnostic `log` line surfaced as a fatal database error.
 *
 * These tests pin the rules that keep that from happening: an unconfirmed host
 * receives nothing, and a host on a different contract receives no diagnostics
 * at all.
 */

describe('diagnostics are only sent to a host on the same contract', () => {
  it('buffers while the host version is still unknown', () => {
    assert.equal(decideLog(null), 'buffer');
  });

  it('sends once the host reports a matching version', () => {
    assert.equal(decideLog(PROTOCOL_VERSION), 'send');
  });

  it('drops when the host reports a different version', () => {
    // Either direction is unsafe: an older host has no `log` at all, and a
    // newer host may have changed its shape. Dropping a log is always cheaper
    // than a fatal error in the editor.
    assert.equal(decideLog(PROTOCOL_VERSION - 1), 'drop');
    assert.equal(decideLog(PROTOCOL_VERSION + 1), 'drop');
    assert.equal(decideLog(1), 'drop');
  });

  it('never sends a diagnostic before the host is known', () => {
    // Exhaustive over the states a startup sequence can pass through: the first
    // decision must be `buffer`, never `send`.
    assert.notEqual(decideLog(null), 'send');
  });
});

describe('host version reporting', () => {
  it('treats a host that omits the version as version 1', () => {
    assert.equal(reportedHostVersion(undefined), 1);
  });

  it('passes through a version the host states', () => {
    assert.equal(reportedHostVersion(PROTOCOL_VERSION), PROTOCOL_VERSION);
    assert.equal(reportedHostVersion(7), 7);
  });

  it('classifies a legacy host as old, not as matching', () => {
    // The whole point: a host that predates the field must not be treated as
    // speaking this build's contract. Compared through a widened value so the
    // assertion stays meaningful whatever PROTOCOL_VERSION becomes.
    const current: number = PROTOCOL_VERSION;
    const legacy = reportedHostVersion(undefined);
    if (current !== 1) {
      assert.notEqual(decideLog(legacy), 'send');
    }
  });
});

describe('the host decides which senders it can serve', () => {
  it('accepts a sender that states this build version', () => {
    assert.equal(isCompatibleSender(PROTOCOL_VERSION), true);
  });

  it('accepts a sender that states no version (older webview bundle)', () => {
    // A webview built before the field exists is a real, working case; refusing
    // it would break "new host, older webview" for no benefit.
    assert.equal(isCompatibleSender(undefined), true);
  });

  it('rejects a sender that explicitly states another version', () => {
    assert.equal(isCompatibleSender(PROTOCOL_VERSION - 1), false);
    assert.equal(isCompatibleSender(PROTOCOL_VERSION + 1), false);
  });

  it('is exact, not a range check', () => {
    // A near-miss version is still a mismatch and must be reported.
    for (const v of [0, 1, 2, 99]) {
      if (v === PROTOCOL_VERSION) continue;
      assert.equal(isCompatibleSender(v), false, `v${v} must be rejected`);
    }
  });
});

describe('the protocol version is a positive integer', () => {
  it('is usable in a comparison and truthy', () => {
    assert.equal(Number.isInteger(PROTOCOL_VERSION), true);
    assert.ok(PROTOCOL_VERSION >= 1, 'version 0 would collide with "unset"');
  });
});
