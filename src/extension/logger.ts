import * as vscode from 'vscode';

/**
 * Logger backed by a real VS Code Output channel, shown under the extension's
 * own name in the Output panel ("SQLite/LibSQL Preview&Edit").
 *
 * The editor's load path spans the extension host and a sandboxed webview, so
 * when something stalls there is otherwise nothing to look at. Every message
 * the host sends or receives, and every step of opening a database, is recorded
 * here with a timestamp so the sequence can be reconstructed after the fact.
 *
 * The channel is created lazily on first use, so activating the extension does
 * not add an empty panel entry.
 */
export class Logger {
  private channel: vscode.LogOutputChannel | undefined;
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /** The channel, created on first use. */
  get output(): vscode.LogOutputChannel {
    if (!this.channel) {
      // `createOutputChannel` with the `{ log: true }` option gives timestamps,
      // severity levels, and the standard VS Code log UI for free.
      this.channel = vscode.window.createOutputChannel(this.name, { log: true });
    }
    return this.channel;
  }

  info(message: string): void {
    this.output.info(message);
  }

  warn(message: string): void {
    this.output.warn(message);
  }

  error(message: string, error?: unknown): void {
    const detail = error instanceof Error ? error.stack ?? error.message : error === undefined ? '' : String(error);
    this.output.error(detail ? `${message} — ${detail}` : message);
  }

  /** Record a structured value (request/response payloads) for diagnosis. */
  trace(label: string, value: unknown): void {
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
    if (text && text.length > 4000) text = text.slice(0, 4000) + `…(+${text.length - 4000} chars)`;
    this.output.debug(`${label} ${text}`);
  }

  /** Reveal the channel, used by the "show log" command. */
  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }
}
