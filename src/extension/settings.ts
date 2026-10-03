// SPDX-FileCopyrightText: 2026 K_PU
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from 'vscode';
import { WebviewSettings } from '../shared/protocol';
import { I18n, Language, resolveLanguage } from './i18n';

/**
 * Central access to the extension's configuration and i18n instance.
 *
 * Re-exported as a singleton from extension.ts; the editor provider, the
 * command handler, and the settings panel all read from here so there is one
 * source of truth for language and page size.
 */
export class ExtensionState {
  readonly settings: vscode.WorkspaceConfiguration;
  readonly i18n: I18n;

  private lastLanguage: Language | undefined;
  private listeners = new Set<(s: WebviewSettings) => void>();

  constructor() {
    this.settings = vscode.workspace.getConfiguration('libSqlPreviewEdit');
    this.i18n = new I18n('en');
    this.applyLanguage();
  }

  /** Reload the language setting and notify the i18n instance. */
  applyLanguage(): void {
    const resolved = resolveLanguage(
      (this.settings.get<string>('language', 'auto') as 'auto' | 'en' | 'zh-cn') || 'auto',
      vscode.env.language || 'en'
    );
    if (resolved !== this.lastLanguage) {
      this.lastLanguage = resolved;
      this.i18n.setLanguage(resolved);
    }
  }

  /** Build a settings snapshot for the webview (current language resolved). */
  getWebviewSettings(): WebviewSettings {
    return {
      language: this.i18n.language,
      pageSize: this.settings.get<number>('pageSize', 50) || 50,
      readOnly: this.settings.get<boolean>('readOnly', false) || false,
      confirmDestructiveActions: this.settings.get<boolean>('confirmDestructiveActions', true) ?? true,
      nullDisplay: this.settings.get<string>('nullDisplay', 'NULL') ?? 'NULL',
      maxCellLength: this.settings.get<number>('maxCellLength', 1000) ?? 1000,
      exportEncoding: (this.settings.get<string>('exportEncoding', 'utf8') as WebviewSettings['exportEncoding']) || 'utf8'
    };
  }

  /** Notify registered listeners of a settings change (e.g. language change). */
  notifySettingsChanged(): void {
    const s = this.getWebviewSettings();
    this.listeners.forEach((l) => l(s));
  }

  /**
   * Persist a language choice to workspace settings and apply it immediately.
   *
   * Writing to the `Global` target keeps the choice across workspaces, matching
   * how a UI-language preference is normally expected to behave.
   */
  async setLanguage(language: Language): Promise<void> {
    await this.settings.update('language', language, vscode.ConfigurationTarget.Global);
    this.lastLanguage = language;
    this.i18n.setLanguage(language);
    this.notifySettingsChanged();
  }

  /** Subscribe to settings changes; returns an unsubscribe function. */
  onSettingsChanged(fn: (s: WebviewSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Read the current language. */
  get language(): Language {
    return this.i18n.language;
  }

  /** Read the pageSize setting. */
  get pageSize(): number {
    return this.settings.get<number>('pageSize', 50) || 50;
  }

  /** Read the readOnly setting. */
  get readOnly(): boolean {
    return this.settings.get<boolean>('readOnly', false) || false;
  }

  /** Read the confirmDestructiveActions setting. */
  get confirmDestructiveActions(): boolean {
    return this.settings.get<boolean>('confirmDestructiveActions', true) ?? true;
  }

  /** Read the nullDisplay setting. */
  get nullDisplay(): string {
    return this.settings.get<string>('nullDisplay', 'NULL') ?? 'NULL';
  }

  /** Read the maxCellLength setting. */
  get maxCellLength(): number {
    return this.settings.get<number>('maxCellLength', 1000) ?? 1000;
  }
}
