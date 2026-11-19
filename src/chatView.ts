import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { ChatSession } from './chatSession';
import { ChatSettings, webviewConfigMessage } from './chatSettings';
import { renderHtml } from './chatWebview';
import { summarizeContext } from './contextBudget';
import { KNOWLEDGE_FILE_NAME, loadKnowledge, renderKnowledge } from './knowledge';
import { SessionContext } from './sessionContext';
import { TerminalCommandEntry } from './types';

export type { AutoAdviseMode } from './autoAdvisePolicy';
export type { ChatSettings } from './chatSettings';
export { renderHtml } from './chatWebview';

/**
 * Chat-Ansicht in der Seitenleiste. Schlicht: Verlauf im Speicher, Frage +
 * Terminal-Kontext an den konfigurierten Endpunkt. Befehle in der Antwort
 * werden als Zeile mit "Einfügen"-Knopf gerendert (schreibt ins Terminal).
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'linkTerminalBot.chat';

  private view: vscode.WebviewView | undefined;
  private readonly session: ChatSession;

  constructor(
    private readonly context: SessionContext,
    private readonly settings: () => ChatSettings,
    private readonly insertCommand: (command: string) => void,
    log: (message: string) => void = () => {},
    private readonly debugLog: (type: string, data: unknown) => void = () => {},
  ) {
    this.session = new ChatSession({
      context,
      settings,
      loadKnowledge: () => this.loadKnowledge(),
      post: message => this.post(message),
      log,
      debugLog,
    });
  }

  /** Nach einem Einfügen aus dem Chat: der nächste Befehl ist die Folge unseres Vorschlags. */
  noteUserAction(): void {
    this.session.noteUserAction();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.session.setVisible(view.visible);
    view.webview.options = { enableScripts: true };
    view.webview.html = renderHtml(view.webview, this.settings());
    view.onDidChangeVisibility(() => {
      if (this.view === view) {
        this.session.setVisible(view.visible);
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.session.setVisible(false);
        this.debugLog('VIEW_CLOSED', 'Chat-Ansicht geschlossen.');
      }
    });
    view.webview.onDidReceiveMessage((message: unknown) => {
      if (this.view === view) {
        void this.handleMessage(message);
      }
    });
    this.debugLog('VIEW_OPENED', { modell: this.settings().model });
  }

  autoAdvise(entry: TerminalCommandEntry, skipCooldown = false): Promise<void> {
    return this.session.autoAdvise(entry, skipCooldown);
  }

  /** Meldet der Ansicht den aktuellen Kontextstand (Befehle, Tokens, Budget). */
  notifyContext(): void {
    const settings = this.settings();
    const summary = summarizeContext(
      this.context.all,
      settings.contextCommands,
      settings.contextMaxTokens,
    );
    this.post({
      type: 'context',
      count: summary.includedCount,
      totalCount: summary.totalCount,
      tokens: summary.tokens,
      maxTokens: settings.contextMaxTokens,
      contextCommands: settings.contextCommands,
      model: settings.model,
      endpoint: settings.endpoint,
    });
  }

  /**
   * azure_knowledge.md aus dem Workspace (Root oder ein Unterordner) — gecacht,
   * solange die Datei unverändert ist. Ohne Datei kommt `undefined` zurück.
   */
  private knowledgeCache: { filePath: string; mtimeMs: number; block: string } | null = null;
  private knowledgeMissAt = 0;

  private async loadKnowledge(): Promise<string | undefined> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return undefined;
    }
    try {
      if (this.knowledgeCache) {
        const stats = await fs.stat(this.knowledgeCache.filePath).catch(() => undefined);
        if (stats && stats.mtimeMs === this.knowledgeCache.mtimeMs) {
          return this.knowledgeCache.block;
        }
      } else if (Date.now() - this.knowledgeMissAt < 30_000) {
        // Gerade eben gesucht und nichts gefunden — nicht bei jeder Frage erneut suchen.
        return undefined;
      }

      const loaded = await loadKnowledge(root);
      if (!loaded) {
        this.knowledgeMissAt = Date.now();
        this.debugLog('KNOWLEDGE_MISSING', { root, gesucht: KNOWLEDGE_FILE_NAME });
        return undefined;
      }
      const stats = await fs.stat(loaded.filePath);
      const block = renderKnowledge(loaded.filePath, loaded.content);
      this.knowledgeCache = { filePath: loaded.filePath, mtimeMs: stats.mtimeMs, block };
      this.knowledgeMissAt = 0;
      this.debugLog('KNOWLEDGE_LOADED', {
        pfad: loaded.filePath,
        zeichen: loaded.content.length,
        gekuerzt: loaded.content.includes('gekürzt'),
      });
      return block;
    } catch (err) {
      this.debugLog('KNOWLEDGE_ERROR', { root, fehler: String(err) });
      return undefined;
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const { type, text, command, stack } = (message ?? {}) as {
      type?: string;
      text?: string;
      command?: string;
      stack?: string;
    };

    if (type === 'openExternal' && text) {
      try {
        const uri = vscode.Uri.parse(text);
        if ((uri.scheme === 'https' || uri.scheme === 'http') && uri.authority) {
          await vscode.env.openExternal(uri);
        }
      } catch (err) {
        this.debugLog('OPEN_EXTERNAL_ERROR', { fehler: String(err) });
      }
      return;
    }
    if (type === 'webviewError') {
      this.debugLog('WEBVIEW_ERROR', { text: text ?? '(ohne Text)', stack: stack ?? null });
      return;
    }
    if (type === 'clear') {
      this.session.clearHistory();
      return;
    }
    if (type === 'settings') {
      this.post(webviewConfigMessage(this.settings()));
      return;
    }
    if (type === 'context') {
      this.notifyContext();
      return;
    }
    if (type === 'insert') {
      if (command && command.trim().length > 0) {
        this.insertCommand(command.trim());
        this.noteUserAction();
        this.post({ type: 'inserted', text: command.trim() });
      }
      return;
    }
    if (type !== 'ask' || !text || text.trim().length === 0) {
      return;
    }

    await this.session.ask(text.trim());
  }
}
