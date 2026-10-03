import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ErrorInfo,
  HostResponse,
  Language,
  WebviewSettings
} from '../../../src/shared/protocol';
import { PROTOCOL_VERSION } from '../../../src/shared/protocol';
import { decideLog, reportedHostVersion } from '../../../src/shared/protocolSkew';

/* ------------------------------------------------------------------------ */
/* VS Code API                                                              */
/* ------------------------------------------------------------------------ */

type VsCodeApiLike = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
  /* Optional: present on newer VS Code versions but not required by us. */
  asWebviewUri?: (uri: { toString: () => string }) => string;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApiLike;
  }
}

/**
 * Safe accessor for the VS Code webview API. Returns a no-op shim if the API
 * is not available (e.g. when the webview is opened in a regular browser
 * during development), so the rest of the app can still render.
 */
function getVsCodeApi(): VsCodeApiLike {
  const factory = window.acquireVsCodeApi;
  if (typeof factory === 'function') {
    try {
      return factory();
    } catch {
      // fall through
    }
  }
  return {
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined
  };
}

/* ------------------------------------------------------------------------ */
/* Types                                                                    */
/* ------------------------------------------------------------------------ */

/** Unsolicited message handler: fires for messages with no matching request. */
export type HostMessageHandler = (msg: HostResponse) => void;

/** A pending request's bookkeeping entry. */
type Pending = {
  resolve: (value: ResponseResult) => void;
  reject: (reason: ResponseResult) => void;
};

/** The shape returned by send(). */
export type ResponseResult = { ok: true; response: HostResponse } | { ok: false; error: ErrorInfo };

/** A strongly-typed wrapper around `send` for a specific request type. */
export interface WebviewBridge {
  /** Send a HostRequest and wait for the matching HostResponse. */
  send: (request: HostRequestShape) => Promise<ResponseResult>;
  /** Register a handler for unsolicited messages (progress, log, etc.). */
  onHostMessage: (handler: HostMessageHandler) => () => void;
  /** The language currently in use (last reported by the host). */
  language: Language;
  /** The settings snapshot from the host (or defaults). */
  settings: WebviewSettings;
  /**
   * Report a diagnostic to the extension host's Output channel.
   *
   * Fire-and-forget: it never throws and never blocks, so it is safe to call
   * from error boundaries and startup paths.
   */
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  /**
   * Typed shortcuts for the requests the UI makes constantly.
   *
   * These used to be re-declared on the memo's type argument as well, which
   * meant the same five signatures existed twice and could drift apart; they
   * belong to the bridge's contract, so they live here.
   */
  executeSql: (sql: string) => Promise<ResponseResult>;
  executeStatements: (statements: string[]) => Promise<ResponseResult>;
  query: (opts: {
    sql: string;
    page: number;
    pageSize: number;
    orderBy?: string;
    where?: string;
  }) => Promise<ResponseResult>;
}

/** Loose shape of a HostRequest — any object with an id + type discriminator. */
export type HostRequestShape = { id?: number; type: string } & Record<string, unknown>;

const DEFAULT_SETTINGS: WebviewSettings = {
  language: 'en',
  pageSize: 50,
  readOnly: false,
  confirmDestructiveActions: true,
  nullDisplay: 'NULL',
  maxCellLength: 1000,
  exportEncoding: 'utf8'
};

/* ------------------------------------------------------------------------ */
/* Hook                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Bridge between the webview and the extension host.
 *
 * Requests are tagged with a monotonic id; responses are matched back by id.
 * Messages with id === 0 are treated as unsolicited (they cannot match a
 * request because ids are always positive) and are forwarded to registered
 * handlers. Progress/log/readOnly messages always come as id 0.
 *
 * The returned `send` function never throws synchronously: it returns a
 * promise that either resolves with the response, or with a synthesised
 * error when the host did not reply (see the `CANCELED` code).
 */
export function useWebview(): WebviewBridge & {
  /** Convenience: execute a whole SQL string and return the first result. */
  executeSql: (sql: string) => Promise<ResponseResult>;
  /** Convenience: execute an array of statements as a batch. */
  executeStatements: (statements: string[]) => Promise<ResponseResult>;
  /** Convenience: run a paged query against a table. */
  query: (opts: {
    sql: string;
    page: number;
    pageSize: number;
    orderBy?: string;
    where?: string;
  }) => Promise<ResponseResult>;
} {
  const vscodeApi = useRef<VsCodeApiLike | null>(null);
  if (!vscodeApi.current) vscodeApi.current = getVsCodeApi();

  /**
   * Raw transport-level diagnostic sink.
   *
   * Defined as a ref (not the `log` callback) because the window listener is
   * installed by an effect that runs before `log` is created, and a ref keeps
   * the listener's identity stable so it is never re-registered.
   */
  const hostLogRef = useRef<(level: 'info' | 'warn' | 'error', message: string) => void>(() => undefined);

  /**
   * Releases diagnostics buffered before the host's protocol version was known.
   *
   * Held in a ref for the same reason as `hostLogRef`: the window listener is
   * installed with an empty dependency list, so it must not close over a
   * callback that is recreated on every render.
   */
  const flushLogsRef = useRef<() => void>(() => undefined);

  const nextId = useRef(1);
  const pending = useRef(new Map<number, Pending>());
  const handlers = useRef(new Set<HostMessageHandler>());

  /**
   * Protocol version the host reported, or null while it is still unknown.
   *
   * Diagnostics are held back until the host proves which contract it speaks.
   * An extension host left running from a build that predates the `log` type
   * answers it with an error reply carrying id 0, and the load path cannot
   * distinguish that from a real database failure — which is precisely how a
   * single diagnostic line broke the editor. Waiting for the host's `ready`
   * snapshot costs one message and removes the whole failure mode.
   */
  const hostProtocol = useRef<number | null>(null);
  const bufferedLogs = useRef<Array<{ level: 'info' | 'warn' | 'error'; message: string }>>([]);

  const [language, setLanguage] = useState<Language>('en');
  const [settings, setSettings] = useState<WebviewSettings>(DEFAULT_SETTINGS);

  const send = useCallback(
    (request: HostRequestShape): Promise<ResponseResult> => {
      return new Promise<ResponseResult>((resolve, reject) => {
        const id = nextId.current++;
        // Announce the contract version on every request so an extension host
        // from an older build can answer with a clear "reload the window"
        // instead of "Unhandled message type".
        const idRequest = { ...request, id, protocolVersion: PROTOCOL_VERSION };
        const entry: Pending = { resolve, reject };
        pending.current.set(id, entry);
        vscodeApi.current!.postMessage(idRequest);
        // Timeout safety: if the host disappears, reject with a synthesised error.
        setTimeout(() => {
          if (!pending.current.has(id)) return;
          pending.current.delete(id);
          reject({
            ok: false,
            error: { code: 'UNKNOWN', message: 'The extension host did not respond.' }
          });
        }, 120_000);
      });
    },
    []
  );

  const onHostMessage = useCallback((handler: HostMessageHandler): (() => void) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  // One-time listener on window.message, dispatching every host response.
  useEffect(() => {
    const listener = (ev: MessageEvent<unknown>) => {
      const msg = ev.data as HostResponse | undefined;
      if (!msg || typeof msg !== 'object' || !('id' in msg) || !('type' in msg)) return;
      const response = msg as HostResponse;

      // Learn the host's contract version from its snapshot. A host built
      // before the field existed omits it, which we record as version 1 so the
      // bridge stays quiet instead of sending messages that host cannot handle.
      if (response.type === 'ready') {
        const reported = reportedHostVersion(response.protocolVersion);
        if (hostProtocol.current !== reported) {
          hostProtocol.current = reported;
          flushLogsRef.current();
        }
      }

      // Record what the host sent; the handshake depends on these arriving.
      hostLogRef.current?.('info', `webview received: id=${response.id} type=${response.type}`);

      // Side effects we care about globally.
      if (response.type === 'languageChanged') {
        setLanguage(response.language);
        setSettings(response.settings);
      } else if (response.type === 'ready') {
        setLanguage(response.settings.language);
        setSettings(response.settings);
      }

      // Route to the matching pending request, if any.
      const id = response.id;
      if (id > 0 && pending.current.has(id)) {
        const entry = pending.current.get(id)!;
        pending.current.delete(id);
        if (response.type === 'error') {
          entry.reject({ ok: false, error: response.error });
        } else {
          entry.resolve({ ok: true, response });
        }
        return;
      }

      // Otherwise: unsolicited message, forward to handlers.
      handlers.current.forEach((h) => {
        try {
          h(response);
        } catch {
          // never let a handler crash the bridge
        }
      });
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
    };
  }, []);

  // On unmount, reject any pending requests so no promise is left dangling.
  useEffect(() => {
    // Capture the map now: the ref is stable, but reading `.current` inside the
    // cleanup is what the rule flags. Draining on unmount is deliberate, so the
    // captured reference is used instead of suppressing the rule.
    const inFlight = pending.current;
    return () => {
      for (const entry of inFlight.values()) {
        entry.reject({
          ok: false,
          error: { code: 'CANCELED', message: 'Webview unmounted.' }
        });
      }
      inFlight.clear();
    };
  }, []);

  const executeSql = useCallback(
    (sql: string) => send({ type: 'executeSql', sql }),
    [send]
  );  const executeStatements = useCallback(
    (statements: string[]) => send({ type: 'executeStatements', statements }),
    [send]
  );
  const query = useCallback(
    (opts: { sql: string; page: number; pageSize: number; orderBy?: string; where?: string }) =>
      send({ type: 'query', ...opts }),
    [send]
  );

  /**
   * Fire-and-forget diagnostic. Uses the raw VS Code API rather than `send`
   * because the host never replies to a log, and using `send` would leave a
   * pending entry (and its timeout) alive for every line.
   */
  const log = useCallback(
    (level: 'info' | 'warn' | 'error', message: string) => {
      // Hold diagnostics back until the host has identified its contract
      // version. Sending `log` to an older host turns a diagnostic line into a
      // fatal load error, so it is not worth the risk to gain a little log
      // ordering; see `decideLog`.
      switch (decideLog(hostProtocol.current)) {
        case 'buffer':
          // Bound the buffer so a host that never answers cannot grow it forever.
          if (bufferedLogs.current.length < 200) bufferedLogs.current.push({ level, message });
          return;
        case 'drop':
          return;
        case 'send':
          break;
      }
      try {
        vscodeApi.current?.postMessage({
          id: 0,
          type: 'log',
          level,
          message,
          protocolVersion: PROTOCOL_VERSION
        });
      } catch {
        // Logging must never be the reason something fails.
      }
    },
    []
  );

  /**
   * Release buffered diagnostics once the host's version is known.
   *
   * Defined as a ref-callable so both the window listener (which learns the
   * version from `ready`) and the `log` callback can reach it without adding
   * dependencies to either.
   */
  const flushLogs = useCallback(() => {
    const buffered = bufferedLogs.current;
    bufferedLogs.current = [];
    for (const entry of buffered) log(entry.level, entry.message);
  }, [log]);

  // Keep the transport-level sink pointed at the current `log`.
  hostLogRef.current = log;
  flushLogsRef.current = flushLogs;

  // Live mirrors of the volatile values, so the memoised bridge can expose them
  // without listing them as dependencies (see below).
  const languageRef = useRef(language);
  languageRef.current = language;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /**
   * The bridge object, with a deliberately permanent identity.
   *
   * Every dependency here is a `useCallback` with stable deps, so this object is
   * created once. That matters because callers put `bridge` in effect dependency
   * arrays (the startup handshake, the page query). If the identity changed per
   * render, those effects would re-run forever — and because a `ready` reply
   * calls `setSettings` with a *fresh object* from the host, including
   * `language`/`settings` as dependencies here produced exactly that loop:
   * ready -> new settings identity -> new bridge -> init again -> ready...
   *
   * The volatile values are therefore exposed via getters over refs, so reading
   * `bridge.settings` always yields the current value while the object identity
   * stays fixed.
   */
  const bridge = useMemo<WebviewBridge>(
    () => ({
      send,
      onHostMessage,
      log,
      executeSql,
      executeStatements,
      query,
      get language() {
        return languageRef.current;
      },
      get settings() {
        return settingsRef.current;
      }
    }),
    [send, onHostMessage, log, executeSql, executeStatements, query]
  );

  return bridge;
}

/* ------------------------------------------------------------------------ */
/* Small shared helpers the UI layer needs                                  */
/* ------------------------------------------------------------------------ */

/** A tiny stable key for a RowEdit (used to detect duplicate edits). */
export { rowEditKey } from '../../../src/shared/protocol';
