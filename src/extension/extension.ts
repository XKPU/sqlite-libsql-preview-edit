// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from 'vscode';
import { DatabaseEditorProvider } from './DatabaseEditorProvider';
import { ExtensionState } from './settings';
import { Logger } from './logger';

/**
 * Extension entry point.
 *
 * Registers the custom editor provider (which owns all DB access and hosts the
 * webview) and a set of toolbar commands. Commands reach the webview through
 * `provider.activePanel()` and a typed postMessage; the webview performs the
 * work and posts back the result through the same channel.
 */
export function activate(context: vscode.ExtensionContext): void {
  const state = new ExtensionState();
  const logger = new Logger('SQLite/LibSQL Preview&Edit');
  context.subscriptions.push(logger);
  const provider = new DatabaseEditorProvider(context, state, logger);
  context.subscriptions.push(provider);
  logger.info('extension activated');

  // Surfacing the log matters when the editor stalls: this command reveals the
  // Output channel so the recorded host/webview traffic can be inspected.
  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.showLog', () => {
      logger.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.open', async (uri?: vscode.Uri) => {
      const target = uri ?? (await pickDatabaseFile(state));
      if (!target) return;
      await vscode.commands.executeCommand('vscode.openWith', target, provider.viewType);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.refresh', async () => {
      const panel = provider.activePanel();
      if (!panel) return;
      // The webview owns refresh: it re-requests info and metadata itself.
      await panel.webview.postMessage({ id: 0, type: 'refreshRequested' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.reopen', async () => {
      const panel = provider.activePanel();
      const uri = provider.activeUri();
      if (!panel || !uri) return;
      await vscode.commands.executeCommand('vscode.openWith', uri, provider.viewType);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.close', async () => {
      await vscode.commands.executeCommand('vscode.close');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.showInfo', async () => {
      const panel = provider.activePanel();
      if (!panel) return;
      const uri = panel.title;
      await vscode.window.showInformationMessage(
        state.i18n.t('info.title') + ': ' + uri
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.openSqlEditor', async () => {
      const panel = provider.activePanel();
      if (!panel) return;
      // Ask the open editor to switch to its SQL tab; the webview owns the
      // editor UI, so the command only signals intent.
      await panel.webview.postMessage({ id: 0, type: 'refreshRequested' });
      await panel.webview.postMessage({ id: 0, type: 'showSql' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('libSqlPreviewEdit.addObject', async () => {
      const panel = provider.activePanel();
      if (!panel) {
        await vscode.window.showInformationMessage(state.i18n.t('cmd.addObject'));
        return;
      }
      await panel.webview.postMessage({ id: 0, type: 'addObject' });
    })
  );
}

async function pickDatabaseFile(state: ExtensionState): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles(
    '**/*.{db,sqlite,sqlite3,libsql}',
    '**/node_modules/**'
  );
  if (files.length === 0) {
    const dialog = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { Database: ['db', 'sqlite', 'sqlite3', 'libsql'] },
      title: state.i18n.t('cmd.open')
    });
    if (!dialog || dialog.length === 0) return undefined;
    return dialog[0];
  }
  const item = await vscode.window.showQuickPick(
    files.slice(0, 100).map((f) => ({ label: f.fsPath, uri: f })),
    { placeHolder: state.i18n.t('cmd.open') }
  );
  return item?.uri;
}

export function deactivate(): void {
  // Cleanup is handled by DatabaseEditorProvider.dispose().
}
