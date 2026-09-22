import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ChatMessage, chatCompletion } from './llmClient';
import { SYSTEM_PROMPT, renderContext } from './prompt';
import { SessionContext } from './sessionContext';

export interface ChatSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  contextCommands: number;
}

/**
 * Chat-Ansicht in der sekundären Seitenleiste (rechts, wo auch Copilot sitzt).
 * Schlicht: Verlauf im Speicher, Frage + Terminal-Kontext an den konfigurierten
 * Endpunkt, Antwort als Text. Kein Streaming, keine Werkzeuge.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'linkTerminalBot.chat';

  private view: vscode.WebviewView | undefined;
  private history: ChatMessage[] = [];

  constructor(
    private readonly context: SessionContext,
    private readonly settings: () => ChatSettings,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderHtml(view.webview, this.settings());
    view.onDidDispose(() => {
      this.view = undefined;
    });
    view.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message));
  }

  /** Meldet der Ansicht, wie viele Befehle gerade als Kontext bereitliegen. */
  notifyContext(): void {
    this.post({ type: 'context', count: this.context.all.length });
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const { type, text } = (message ?? {}) as { type?: string; text?: string };

    if (type === 'clear') {
      this.history = [];
      this.post({ type: 'cleared' });
      return;
    }
    if (type === 'settings') {
      this.post({ type: 'config', settings: this.settings() });
      return;
    }
    if (type !== 'ask' || !text || text.trim().length === 0) {
      return;
    }

    const question = text.trim();
    const settings = this.settings();
    const previous = this.history;
    this.post({ type: 'busy', busy: true });

    try {
      const answer = await chatCompletion({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...previous,
          {
            role: 'user',
            content: `${question}\n\n${renderContext(this.context.all, settings.contextCommands)}`,
          },
        ],
      });
      this.history = [
        ...previous,
        { role: 'user', content: question },
        { role: 'assistant', content: answer },
      ];
      this.post({ type: 'answer', text: answer });
    } catch (err) {
      this.post({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      this.post({ type: 'busy', busy: false });
    }
  }
}

function renderHtml(webview: vscode.Webview, settings: ChatSettings): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const configured = settings.endpoint.trim().length > 0;
  const hint = configured
    ? `${settings.model} @ ${settings.endpoint}`
    : 'Kein Endpunkt gesetzt: linkTerminalBot.chatEndpoint in den Einstellungen füllen.';

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body {
    margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  #log { flex: 1; overflow-y: auto; padding: 8px; }
  .msg { margin: 0 0 10px 0; padding-left: 6px; white-space: pre-wrap; word-break: break-word; }
  .user { border-left: 2px solid var(--vscode-focusBorder); }
  .bot { border-left: 2px solid var(--vscode-descriptionForeground); }
  .err { border-left: 2px solid var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 0 8px 4px 8px; }
  #row { display: flex; gap: 4px; padding: 6px; border-top: 1px solid var(--vscode-panel-border); }
  textarea {
    flex: 1; height: 54px; resize: vertical; box-sizing: border-box;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); padding: 4px;
    font-family: inherit; font-size: inherit;
  }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 0 10px; cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  #bar { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<div id="log"></div>
<div id="bar"><span class="meta" id="status"></span><span class="meta" id="ctx"></span></div>
<div id="row">
  <textarea id="input" placeholder="Was ist das Problem? (Enter = senden, Shift+Enter = neue Zeile)"></textarea>
  <button id="send">Senden</button>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const status = document.getElementById('status');
  const ctx = document.getElementById('ctx');
  const initial = ${JSON.stringify(hint)};
  let pending = null;
  let busy = false;

  function add(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function setBusy(value) {
    busy = value;
    send.disabled = value;
    status.textContent = value ? 'wartet auf Antwort …' : initial;
  }
  setBusy(false);

  function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    add('user', text);
    input.value = '';
    vscode.postMessage({ type: 'ask', text: text });
  }

  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'answer') {
      pending = null;
      add('bot', msg.text);
    } else if (msg.type === 'error') {
      add('err', 'Fehler: ' + msg.text);
    } else if (msg.type === 'busy') {
      setBusy(!!msg.busy);
    } else if (msg.type === 'context') {
      ctx.textContent = msg.count + ' Befehle im Kontext';
    } else if (msg.type === 'cleared') {
      log.textContent = '';
      add('meta', 'Verlauf geleert.');
    }
  });
  vscode.postMessage({ type: 'settings' });
  vscode.postMessage({ type: 'context' });
</script>
</body>
</html>`;
}
