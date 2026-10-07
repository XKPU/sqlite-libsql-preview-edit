// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseAdapter } from './adapter/adapter';
import { SqliteAdapter } from './adapter/sqliteAdapter';
import {
  ErrorInfo,
  ExportFormat,
  HostRequest,
  HostResponse,
  ObjectType,
  PROTOCOL_VERSION,
  RowEdit,
  SqlValue
} from '../shared/protocol';
import { isCompatibleSender } from '../shared/protocolSkew';
import { ExtensionState } from './settings';
import { Logger } from './logger';
import { makeNonce, rewriteWebviewHtml } from './webviewHtml';

/**
 * A custom document backed by a database file.
 *
 * `CustomReadonlyEditorProvider` asks us for one of these the first time a
 * resource is opened; the same instance is handed to every editor view of that
 * resource. It only has to carry the URI and clean itself up, because the
 * adapter lives per editor panel (see `Session`), not per document.
 */
class DatabaseDocument implements vscode.CustomDocument {
  private disposed = false;

  constructor(readonly uri: vscode.Uri) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
  }
}

/**
 * Everything tied to one open editor view: its own adapter, its own file, and
 * the panel it renders into.
 *
 * Each panel gets an independent adapter so opening two databases in two tabs
 * cannot make one clobber the other — with a single shared adapter, the second
 * file opened would silently replace the first.
 */
interface Session {
  panel: vscode.WebviewPanel;
  document: DatabaseDocument;
  adapter: DatabaseAdapter;
  /**
   * Why the initial `open()` failed, if it did.
   *
   * The first open is kicked off as soon as the editor resolves, which is
   * before the webview script has loaded and attached its message listener —
   * so an error posted at that moment is dropped and the webview stays on its
   * loading placeholder forever. Replaying it when the webview sends `init`
   * closes that race.
   */
  openError?: ErrorInfo;
}

/**
 * Custom editor provider for SQLite / LibSQL files.
 *
 * The provider is registered for the `customEditors` contribution point, so
 * clicking a database in the Explorer opens this editor in the normal editor
 * group — there is deliberately no separate webview panel or native window.
 *
 * All SQLite access happens through a `DatabaseAdapter`, so every write is
 * wrapped in a transaction and the provider itself never touches SQLite.
 */
export class DatabaseEditorProvider implements vscode.CustomReadonlyEditorProvider {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sessions = new Map<vscode.WebviewPanel, Session>();
  private lastActivePanel: vscode.WebviewPanel | undefined;

  readonly viewType = 'libSqlPreviewEdit.editor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: ExtensionState,
    private readonly logger: Logger
  ) {
    this.disposables.push(
      vscode.window.registerCustomEditorProvider(this.viewType, this, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true
      })
    );
    this.disposables.push(this.registerConfigurationListener());
  }

  /**
   * Create the database adapter — the native SQLite engine (`better-sqlite3`).
   *
   * There is exactly one engine: a local-file binding to stock SQLite, which
   * reads and writes the shared `SQLite format 3` container. Because all three
   * dialects share that container, this single adapter opens SQLite, libSQL and
   * Turso Database files alike, so there is no fallback path to select between.
   * A Turso file still opens and its ordinary tables still read and write; only
   * statements exclusive to that engine fail, which `capabilities` reports.
   *
   * The packaged VSIX must ship the engine's native binary, otherwise
   * construction fails immediately.
   */
  private createAdapter(): DatabaseAdapter {
    return new SqliteAdapter();
  }

  /* ------------------------------- lifecycle ---------------------------- */

  openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): vscode.CustomDocument {
    this.logger.info(`openCustomDocument: ${uri.fsPath}`);
    return new DatabaseDocument(uri);
  }

  resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    const doc = document as DatabaseDocument;
    this.logger.info(`resolveCustomEditor begin: ${doc.uri.fsPath}`);
    const session: Session = {
      panel,
      document: doc,
      adapter: this.createAdapter()
    };
    this.sessions.set(panel, session);
    this.lastActivePanel = panel;
    this.logger.info(`resolveCustomEditor: ${doc.uri.fsPath}`);

    panel.webview.options = {
      enableScripts: true,
      enableForms: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview')]
    };
    panel.webview.html = this.buildHtml(panel.webview);
    this.logger.info(`webview html built for: ${doc.uri.fsPath}`);

    // Track which editor is active so the toolbar commands know their target.
    panel.onDidChangeViewState(() => {
      if (panel.active) this.lastActivePanel = panel;
    });

    panel.webview.onDidReceiveMessage((msg: HostRequest) => {
      this.logger.trace(`-> host received:`, msg);
      void this.handleMessage(msg, panel);
    });

    panel.onDidDispose(() => {
      const current = this.sessions.get(panel);
      this.sessions.delete(panel);
      if (this.lastActivePanel === panel) this.lastActivePanel = undefined;
      this.logger.info(`panel disposed: ${doc.uri.fsPath}`);
      if (current) void current.adapter.close().catch(() => undefined);
      // NOTE: never call panel.dispose() from inside onDidDispose — the panel
      // is already being torn down and re-entrant disposal would recurse.
    });

    void this.openAndReport(session, doc.uri).catch((e: unknown) => {
      // Without this, a rejection here is an unhandled promise rejection and the
      // editor would sit on its loading placeholder with no explanation.
      this.logger.error(`openAndReport threw: ${e instanceof Error ? e.message : String(e)}`);
      this.postMessage(session.panel, {
        id: 0,
        type: 'error',
        error: { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
      });
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    for (const session of this.sessions.values()) {
      void session.adapter.close().catch(() => undefined);
    }
    this.sessions.clear();
  }

  /** The editor the toolbar commands should act on, or undefined. */
  activePanel(): vscode.WebviewPanel | undefined {
    if (this.lastActivePanel && this.sessions.has(this.lastActivePanel)) {
      return this.lastActivePanel;
    }
    const first = this.sessions.keys().next();
    return first.done ? undefined : first.value;
  }

  /** The adapter behind the active editor, used by the SQL-editor command. */
  activeAdapter(): DatabaseAdapter | undefined {
    const panel = this.activePanel();
    return panel ? this.sessions.get(panel)?.adapter : undefined;
  }

  /** The file backing the active editor, used by the reopen command. */
  activeUri(): vscode.Uri | undefined {
    const panel = this.activePanel();
    return panel ? this.sessions.get(panel)?.document.uri : undefined;
  }

  /* ---------------------------- configuration -------------------------- */

  private registerConfigurationListener(): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('libSqlPreviewEdit')) return;
      this.state.applyLanguage();
      this.state.notifySettingsChanged();
      const settings = this.state.getWebviewSettings();
      for (const session of this.sessions.values()) {
        void session.panel.webview.postMessage({
          id: 0,
          type: 'languageChanged',
          language: this.state.language,
          settings
        } as HostResponse);
      }
    });
  }

  /* ---------------------------- message router -------------------------- */

  private async handleMessage(msg: HostRequest, panel: vscode.WebviewPanel): Promise<void> {
    const session = this.sessions.get(panel);
    if (!session) {
      this.logger.warn(`dropped ${msg.type} (id=${msg.id}): panel has no session`);
      return;
    }
    const respond = (r: HostResponse) => this.postMessage(panel, r);
    const error = (e: ErrorInfo) => respond({ id: msg.id, type: 'error', error: e });
    const adapter = session.adapter;

    /**
     * Run one adapter call and turn its outcome into the reply for `msg`.
     *
     * Every request handler has the same shape — call the adapter, hand an
     * error straight back to the caller, otherwise map the value onto a
     * response — and that shape used to be written out by hand seventeen times.
     * Folding it into one helper means an error can no longer be forgotten in
     * one branch, and a new request only has to describe its happy path.
     */
    const answer = async <T>(
      call: () => Promise<T | ErrorInfo>,
      toResponse: (value: T) => HostResponse
    ): Promise<void> => {
      const r = await call();
      respond(isError(r) ? { id: msg.id, type: 'error', error: r } : toResponse(r));
    };

    // A request built against a different contract version means VS Code is
    // running an extension host from an older build than the webview bundle on
    // disk (installing a .vsix does not restart a live host). Say so plainly
    // rather than failing on whichever message type happens to be new. A
    // request with no version at all predates the field and is accepted; see
    // `isCompatibleSender`.
    if (!isCompatibleSender(msg.protocolVersion)) {
      this.logger.warn(
        `protocol version mismatch: sender speaks v${msg.protocolVersion}, host speaks v${PROTOCOL_VERSION}`
      );
      // Diagnostics must never be the thing that breaks the editor, even when
      // the versions disagree; a `log` needs no reply at all.
      if (msg.type === 'log') return;
      return error({
        code: 'VERSION_MISMATCH',
        message:
          `The webview (protocol v${msg.protocolVersion}) and the extension host ` +
          `(protocol v${PROTOCOL_VERSION}) are from different builds. ` +
          `Reload the window to finish updating the extension.`
      });
    }

    try {
      switch (msg.type) {
        case 'init':
          // Handshake: (re)send the snapshot the webview may have missed
          // because it was not listening when resolveCustomEditor pushed it.
          //
          // A failed open is replayed here rather than only at open time: the
          // webview attaches its listener after the host has already tried to
          // open, so the original failure notice would be lost and the editor
          // would sit on its loading placeholder.
          if (session.openError) {
            this.logger.info(`replaying open failure on init (${session.openError.code})`);
            respond({ id: msg.id, type: 'error', error: session.openError });
            return;
          }
          await this.sendState(session, msg.id);
          return;
        case 'close':
          await adapter.close();
          respond({ id: msg.id, type: 'closed' });
          return;
        case 'log':
          // Mirrors a webview-side diagnostic into the Output channel.
          if (msg.level === 'error') this.logger.error(`[webview] ${msg.message}`);
          else if (msg.level === 'warn') this.logger.warn(`[webview] ${msg.message}`);
          else this.logger.info(`[webview] ${msg.message}`);
          return;
        case 'setLanguage':
          // Storing the setting triggers onDidChangeConfiguration, which
          // broadcasts `languageChanged` to every open editor — including this
          // one — so all editors switch together.
          await this.state.setLanguage(msg.language);
          respond({ id: msg.id, type: 'languageChanged', language: this.state.language, settings: this.state.getWebviewSettings() });
          return;
        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:u-eptm.sqlite-libsql-preview-edit');
          return;
        case 'getInfo':
          await answer(
            () => adapter.getInfo(),
            (info) => ({ id: msg.id, type: 'info', info })
          );
          return;
        case 'getMetadata':
          await answer(
            () => adapter.getObjects(true),
            (objects) => ({ id: msg.id, type: 'metadata', objects })
          );
          return;
        case 'getSchema':
          await answer(
            () => adapter.getSchema(msg.objectName),
            (r) => ({ id: msg.id, type: 'schema', columns: r.columns, sql: r.sql })
          );
          return;
        case 'query':
          await answer(
            () => adapter.query(msg.sql, msg.page, msg.pageSize),
            (result) => ({ id: msg.id, type: 'result', result })
          );
          return;
        case 'rowCount':
          await answer(
            () => adapter.rowCount(msg.objectName),
            // A count is presented as a one-cell result so the grid can render
            // it without a second code path.
            (r) => ({
              id: msg.id,
              type: 'result',
              result: {
                columns: [],
                rows: [[r]],
                totalRows: r,
                truncated: false,
                isQuery: false,
                durationMs: 0
              }
            })
          );
          return;
        case 'commitEdits':
          await answer(
            () => adapter.commitEdits(msg.edits as RowEdit[]),
            (r) => ({ id: msg.id, type: 'saved', changes: r.changes })
          );
          return;
        case 'insertRow':
          await answer(
            () => adapter.insertRow(msg.table, msg.values as Record<string, SqlValue>),
            () => ({ id: msg.id, type: 'saved', changes: 1 })
          );
          return;
        case 'deleteRows':
          await answer(
            () => adapter.deleteRows(msg.keys),
            (r) => ({ id: msg.id, type: 'saved', changes: r.changes })
          );
          return;
        case 'duplicateRow':
          await answer(
            () => adapter.duplicateRow(msg.key.table, msg.key.keyColumns, msg.key.keyValues),
            () => ({ id: msg.id, type: 'saved', changes: 1 })
          );
          return;
        case 'export':
          await answer(
            async () => {
              // Ask where to save BEFORE doing the work: a cancelled dialog must
              // not leave a half-written file or waste a full table scan.
              const dest = await this.askExportPath(msg.format, msg.objectName);
              if (!dest) return { cancelled: true } as const;
              return adapter.export(msg.format, msg.objectName, msg.selectSql, dest);
            },
            (r) =>
              'cancelled' in r
                ? { id: msg.id, type: 'exportCancelled', format: msg.format }
                : {
                    id: msg.id,
                    type: 'exported',
                    filePath: (r as { filePath: string }).filePath,
                    sizeBytes: (r as { sizeBytes: number }).sizeBytes,
                    format: msg.format
                  }
          );
          return;
        case 'exportDatabase':
          await answer(
            async () => {
              const dest = await this.askExportPath(msg.format);
              if (!dest) return { cancelled: true } as const;
              return adapter.exportDatabase(msg.format, dest);
            },
            (r) =>
              'cancelled' in r
                ? { id: msg.id, type: 'exportCancelled', format: msg.format }
                : {
                    id: msg.id,
                    type: 'exported',
                    filePath: (r as { filePath: string }).filePath,
                    sizeBytes: (r as { sizeBytes: number }).sizeBytes,
                    format: msg.format
                  }
          );
          return;
        case 'importPreview':
          await answer(
            () => adapter.importPreview(msg.filePath, msg.format),
            (r) => ({
              id: msg.id,
              type: 'importPreview',
              headers: r.headers,
              mappings: r.mappings,
              previewRows: r.previewRows
            })
          );
          return;
        case 'importCommit':
          await answer(
            () =>
              adapter.importCommit(
                msg.filePath,
                msg.options.tableName,
                msg.options.mappings,
                msg.options.conflict,
                msg.options.createTable
              ),
            (r) => ({
              id: msg.id,
              type: 'imported',
              rows: r.rows,
              skipped: r.skipped,
              tableName: r.tableName
            })
          );
          return;
        case 'executeSql':
          await answer(
            () => adapter.executeSql(msg.sql),
            (result) => ({ id: msg.id, type: 'result', result })
          );
          return;
        case 'executeStatements':
          await answer(
            () => adapter.executeStatements(msg.statements),
            (r) => ({
              id: msg.id,
              type: 'result',
              result: {
                columns: [],
                rows: [[r.affectedRows]],
                totalRows: 0,
                truncated: false,
                affectedRows: r.affectedRows,
                isQuery: false,
                durationMs: 0
              }
            })
          );
          return;
        case 'executeDdl':
          await answer(
            () => adapter.executeDdl(msg.statements),
            (r) => ({ id: msg.id, type: 'saved', changes: r.statements })
          );
          return;
        case 'deleteObject': {
          if (this.state.confirmDestructiveActions) {
            const label = this.deleteTitle(msg.objectType, msg.name);
            const confirmLabel = this.state.i18n.t('confirm');
            const confirm = await vscode.window.showWarningMessage(
              label,
              { modal: true },
              confirmLabel
            );
            if (confirm !== confirmLabel) {
              respond({
                id: msg.id,
                type: 'error',
                error: { code: 'CANCELED', message: 'Cancelled' }
              });
              return;
            }
          }
          await answer(
            () => adapter.deleteObject(msg.name, msg.objectType),
            () => ({
              id: msg.id,
              type: 'objectDeleted',
              name: msg.name,
              objectType: msg.objectType
            })
          );
          return;
        }
        case 'open': {
          const target = vscode.Uri.file(msg.path);
          if (target.fsPath !== session.document.uri.fsPath) {
            session.document = new DatabaseDocument(target);
          }
          // Reopen an existing session on a different file. `openAndReport`
          // reports failures itself, so the only additional guard needed is
          // against an unexpected throw leaving the panel on a stale state.
          try {
            await this.openAndReport(session, target);
          } catch (e: unknown) {
            this.logger.error(`reopen threw: ${e instanceof Error ? e.message : String(e)}`);
          }
          return;
        }
        default: {
          // Reaching here with a matching protocol version means the webview
          // sent something this build genuinely does not implement. Log it as a
          // warning instead of a user-facing error: a diagnostic must never be
          // able to present itself as a failed database load. `msg` is narrowed
          // to `never` by the exhaustive switch, so read the fields it carries
          // through an explicit shape.
          const unknown = msg as unknown as { type: string; id: number };
          this.logger.warn(`Unhandled message type: ${unknown.type}`);
          if (unknown.id > 0) {
            return error({
              code: 'UNKNOWN',
              message: `Unhandled message type: ${unknown.type}`
            });
          }
          return;
        }
      }
    } catch (e) {
      return error({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Ask the user where an export should be written.
   *
   * Exports used to be saved into a private temporary directory and the path
   * merely reported in a toast, so the file was effectively lost to the user:
   * they never chose a location and had no practical way to open the result.
   *
   * Returns `undefined` when the user dismisses the dialog, so the caller can
   * tell "cancelled" apart from "failed" and avoid writing anything at all.
   */
  private async askExportPath(format: ExportFormat, objectName?: string): Promise<string | undefined> {
    // Suggested name: the object being exported, else the database file's own
    // name, so the default is meaningful instead of a generic "database.sql".
    const stem = objectName ?? this.dbFileStem() ?? 'database';
    const filters: Record<string, string[]> =
      format === 'sql' ? { SQL: ['sql'] } : format === 'json' ? { JSON: ['json'] } : { CSV: ['csv'] };

    const picked = await vscode.window.showSaveDialog({
      title: `Export ${objectName ?? 'database'}`,
      defaultUri: vscode.Uri.file(path.join(this.exportDefaultDir(), `${stem}.${format}`)),
      filters,
      saveLabel: 'Export'
    });
    return picked?.fsPath;
  }

  /** Open database's directory, so the save dialog starts somewhere relevant. */
  private exportDefaultDir(): string {
    const uri = this.activeDocumentUri();
    return uri ? path.dirname(uri.fsPath) : os.homedir();
  }

  /** Open database's file name without its extension, or undefined. */
  private dbFileStem(): string | undefined {
    const uri = this.activeDocumentUri();
    return uri ? path.basename(uri.fsPath, path.extname(uri.fsPath)) : undefined;
  }

  private activeDocumentUri(): vscode.Uri | undefined {
    if (!this.lastActivePanel) return undefined;
    return this.sessions.get(this.lastActivePanel)?.document.uri;
  }

  private deleteTitle(type: ObjectType, name: string): string {
    switch (type) {
      case 'table':
        return this.state.i18n.t('confirm.deleteTable.title', { name });
      case 'view':
        return this.state.i18n.t('confirm.deleteView.title', { name });
      case 'index':
        return this.state.i18n.t('confirm.deleteIndex.title', { name });
      case 'trigger':
        return this.state.i18n.t('confirm.deleteTrigger.title', { name });
      default:
        return `${type}: ${name}`;
    }
  }

  /**
   * Open the file and post the initial snapshot, then re-send it on demand.
   *
   * The initial post can race the webview's listener, so the webview also asks
   * for the state with an `init` request; both paths funnel through
   * `sendState` so the snapshot is assembled identically either way.
   */
  private async openAndReport(session: Session, uri: vscode.Uri): Promise<void> {
    this.logger.info(`opening database: ${uri.fsPath}`);
    const r = await session.adapter.open(uri.fsPath);
    if (isError(r)) {
      this.logger.error(`open failed (${r.code}): ${r.message}`);
      // Remember the cause: the webview is very likely not listening yet (see
      // `Session.openError`), so this post may be dropped. The `init` handler
      // replays it.
      session.openError = r;
      this.postMessage(session.panel, {
        id: 0,
        type: 'error',
        error: { code: r.code, message: r.message, raw: r.raw }
      });
      return;
    }
    session.openError = undefined;
    this.logger.info(
      `opened: driver=${r.driver} engine=${r.engine} version=${r.version} size=${r.sizeBytes} writable=${r.writable}`
    );
    this.logger.info(
      `LibSQL detection: libSql=${r.detection.libSql} decidedBy=${r.detection.decidedBy} fallback=${r.detection.fallback} evidence=${r.detection.evidence.map((e) => `${e.kind}:${e.weight}`).join(',') || '(none)'}`
    );
    await this.sendState(session, 0);
  }

  /** Post the current database snapshot to the webview. */
  private async sendState(session: Session, id: number): Promise<void> {
    const info = await session.adapter.getInfo();
    if (isError(info)) {
      this.logger.error(`getInfo failed (${info.code}): ${info.message}`);
      this.postMessage(session.panel, {
        id,
        type: 'error',
        error: { code: info.code, message: info.message, raw: info.raw }
      });
      return;
    }
    const objects = await session.adapter.getObjects(true);
    if (isError(objects)) {
      this.logger.warn(`getObjects failed (${objects.code}): ${objects.message}`);
    }
    this.logger.info(
      `sending ready snapshot (request id=${id}): ${isError(objects) ? 0 : objects.length} object(s)`
    );
    this.postMessage(session.panel, {
      id,
      type: 'ready',
      info,
      objects: isError(objects) ? [] : objects,
      settings: this.state.getWebviewSettings(),
      protocolVersion: PROTOCOL_VERSION
    });
  }

  private postMessage(panel: vscode.WebviewPanel, msg: HostResponse): void {
    this.logger.trace(`<- host sending:`, msg);
    void panel.webview.postMessage(msg);
  }

  /* --------------------------------- HTML -------------------------------- */

  /**
   * Build the webview HTML from the Vite output.
   *
   * The Vite bundle references its assets with relative URLs, which a VS Code
   * webview cannot resolve: every `src`/`href` must be rewritten to a
   * `webview.asWebviewUri()` URL, and the content security policy must allow
   * exactly those resources plus a per-load nonce for the script.
   */
  private buildHtml(webview: vscode.Webview): string {
    const htmlPath = this.context.asAbsolutePath('out/webview/index.html');
    let html: string;
    try {
      html = fs.readFileSync(htmlPath, 'utf8');
    } catch {
      return this.notBuiltHtml();
    }

    const outDir = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview');
    return rewriteWebviewHtml(html, {
      toWebviewUri: (ref) => {
        const clean = ref.replace(/^\.?\//, '');
        return webview.asWebviewUri(vscode.Uri.joinPath(outDir, ...clean.split('/'))).toString();
      },
      nonce: makeNonce(),
      cspSource: webview.cspSource
    });
  }

  private notBuiltHtml(): string {
    return (
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<h1>SQLite/LibSQL/Turso P&amp;E</h1>' +
      '<p>The webview has not been built yet. Run <code>npm run compile</code>.</p>' +
      '</body></html>'
    );
  }
}

function isError(v: unknown): v is ErrorInfo {
  return typeof v === 'object' && v !== null && typeof (v as ErrorInfo).code === 'string';
}
