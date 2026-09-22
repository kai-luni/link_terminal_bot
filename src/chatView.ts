import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ChatMessage, chatCompletion } from './llmClient';
import {
  AUTO_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  isSilent,
  renderAutoContext,
  renderContext,
} from './prompt';
import { SessionContext } from './sessionContext';
import { TerminalCommandEntry } from './types';

export type AutoAdviseMode = 'off' | 'errors' | 'always';

export interface ChatSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  contextCommands: number;
  autoAdvise: AutoAdviseMode;
  autoAdviseSeconds: number;
}

/**
 * Chat-Ansicht in der Seitenleiste. Schlicht: Verlauf im Speicher, Frage +
 * Terminal-Kontext an den konfigurierten Endpunkt. Befehle in der Antwort
 * werden als Zeile mit "Einfügen"-Knopf gerendert (schreibt ins Terminal).
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'linkTerminalBot.chat';

  private view: vscode.WebviewView | undefined;
  private history: ChatMessage[] = [];
  private lastAutoAt = 0;
  private autoInFlight = false;

  constructor(
    private readonly context: SessionContext,
    private readonly settings: () => ChatSettings,
    private readonly insertCommand: (command: string) => void,
    private readonly log: (message: string) => void = () => {},
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

  /**
   * Reagiert von sich aus auf einen beendeten Befehl — oder schweigt.
   * Nur wenn das Modell es für nötig hält, landet eine Nachricht im Chat.
   */
  async autoAdvise(entry: TerminalCommandEntry): Promise<void> {
    const settings = this.settings();
    if (settings.autoAdvise === 'off' || this.autoInFlight) {
      return;
    }
    const failed = entry.exitCode === undefined || entry.exitCode !== 0;
    if (settings.autoAdvise === 'errors' && !failed) {
      return;
    }
    const now = Date.now();
    if (now - this.lastAutoAt < Math.max(0, settings.autoAdviseSeconds) * 1000) {
      return;
    }
    this.autoInFlight = true;
    this.lastAutoAt = now;

    try {
      const answer = await chatCompletion({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: [
          { role: 'system', content: AUTO_SYSTEM_PROMPT },
          {
            role: 'user',
            content: renderAutoContext(entry, this.context.all, settings.contextCommands),
          },
        ],
      });
      if (isSilent(answer)) {
        this.log(`[${entry.id}] $ ${entry.command} -> exit ${entry.exitCode ?? '?'}: kein Hinweis`);
        return;
      }
      this.history.push({ role: 'assistant', content: answer });
      this.post({
        type: 'answer',
        text: answer,
        auto: true,
        label: `automatisch · $ ${entry.command} (exit ${entry.exitCode ?? '?'})`,
      });
      this.log(`[${entry.id}] automatischer Hinweis: ${answer.split('\n')[0]}`);
    } catch (err) {
      // Ein automatischer Hinweis darf den Ablauf nicht stören — nur ins Log.
      this.log(`[${entry.id}] automatischer Hinweis fehlgeschlagen: ${String(err)}`);
      this.lastAutoAt = 0;
    } finally {
      this.autoInFlight = false;
    }
  }

  /** Meldet der Ansicht, wie viele Befehle gerade als Kontext bereitliegen. */
  notifyContext(): void {
    this.post({ type: 'context', count: this.context.all.length });
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const { type, text, command } = (message ?? {}) as {
      type?: string;
      text?: string;
      command?: string;
    };

    if (type === 'clear') {
      this.history = [];
      this.post({ type: 'cleared' });
      return;
    }
    if (type === 'settings') {
      this.post({ type: 'config', settings: this.settings() });
      return;
    }
    if (type === 'insert') {
      if (command && command.trim().length > 0) {
        this.insertCommand(command.trim());
        this.post({ type: 'inserted', text: command.trim() });
      }
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

export function renderHtml(webview: vscode.Webview, settings: ChatSettings): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const hint = settings.endpoint.trim().length > 0
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
  .msg { margin: 0 0 10px 0; padding-left: 6px; }
  .user { border-left: 2px solid var(--vscode-focusBorder); white-space: pre-wrap; word-break: break-word; }
  .bot { border-left: 2px solid var(--vscode-descriptionForeground); }
  .err { border-left: 2px solid var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 0 8px 4px 8px; }
  .cmd { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
  .cmd code {
    flex: 1; background: var(--vscode-textCodeBlock-background); padding: 2px 6px;
    white-space: pre-wrap; word-break: break-all; user-select: all;
  }
  .ins {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none; padding: 3px 8px; font-size: 0.9em; cursor: pointer; white-space: nowrap;
  }
  .ins:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .plain { white-space: pre-wrap; word-break: break-word; }
  .plain code { background: var(--vscode-textCodeBlock-background); padding: 0 3px; }
  #row { display: flex; gap: 4px; padding: 6px; border-top: 1px solid var(--vscode-panel-border); }
  textarea {
    flex: 1; height: 54px; resize: vertical; box-sizing: border-box;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); padding: 4px;
    font-family: inherit; font-size: inherit;
  }
  #send {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 0 10px; cursor: pointer;
  }
  #send:disabled { opacity: 0.5; cursor: default; }
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
  const FENCE = String.fromCharCode(96, 96, 96);
  const TICK = String.fromCharCode(96);
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const status = document.getElementById('status');
  const ctx = document.getElementById('ctx');
  const initial = ${JSON.stringify(hint)};
  let busy = false;
  let statusTimer = null;

  function setStatus(text) {
    status.textContent = text;
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (text !== initial) {
      statusTimer = setTimeout(() => { status.textContent = initial; }, 4000);
    }
  }
  setStatus(initial);

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    setStatus(value ? 'wartet auf Antwort …' : initial);
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(s) {
    return esc(s)
      .replace(new RegExp(TICK + '([^' + TICK + ']+)' + TICK, 'g'), '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>');
  }
  function isCommand(line) {
    return /^(az|azd)\\s+\\S/.test(line);
  }

  function cmdRow(line) {
    const row = document.createElement('div');
    row.className = 'cmd';
    const code = document.createElement('code');
    code.textContent = line;
    const btn = document.createElement('button');
    btn.className = 'ins';
    btn.textContent = 'Einfügen';
    btn.title = 'In das aktive Terminal einfügen';
    btn.addEventListener('click', () => vscode.postMessage({ type: 'insert', command: line }));
    row.appendChild(code);
    row.appendChild(btn);
    return row;
  }

  function append(scroll) {
    const el = document.createElement('div');
    log.appendChild(el);
    if (scroll) { log.scrollTop = log.scrollHeight; }
    return el;
  }

  function addPlain(cls, text) {
    const el = append(true);
    el.className = 'msg ' + cls;
    el.textContent = text;
    return el;
  }

  // Antworten des Bots: Codeblöcke werden zu einem einfügbaren Befehl,
  // az-Zeilen im Fließtext ebenfalls.
  function addRich(text) {
    const wrap = append(false);
    wrap.className = 'msg bot';
    const parts = String(text).split(FENCE);
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        // Codeblock: ein Block = ein Befehl, auch mehrzeilig (z. B. PowerShell).
        const lines = part.replace(/^\\n+/, '').replace(/\\n+$/, '').split('\\n');
        if (lines.length > 0 && /^[a-zA-Z0-9+#-]{0,12}$/.test(lines[0].trim())) {
          lines.shift();
        }
        const body = lines.join('\\n').replace(/^\\n+|\\n+$/g, '');
        if (body.trim()) {
          wrap.appendChild(cmdRow(body.trim()));
        }
        return;
      }
      for (const raw of part.split('\\n')) {
        const line = raw.trim();
        if (!line) { continue; }
        if (isCommand(line)) {
          wrap.appendChild(cmdRow(line));
        } else {
          const el = document.createElement('div');
          el.className = 'plain';
          el.innerHTML = fmt(line);
          wrap.appendChild(el);
        }
      }
    });
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function submit() {
    const text = input.value.trim();
    if (!text || busy) { return; }
    addPlain('user', text);
    input.value = '';
    vscode.postMessage({ type: 'ask', text: text });
  }

  send.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'answer') {
      if (msg.auto) { addPlain('meta', msg.label || 'automatischer Hinweis'); }
      addRich(msg.text);
    } else if (msg.type === 'error') {
      addPlain('err', 'Fehler: ' + msg.text);
    } else if (msg.type === 'busy') {
      setBusy(!!msg.busy);
    } else if (msg.type === 'context') {
      ctx.textContent = msg.count + ' Befehle im Kontext';
    } else if (msg.type === 'inserted') {
      setStatus('ins Terminal eingefügt: ' + msg.text);
    } else if (msg.type === 'cleared') {
      log.textContent = '';
      addPlain('meta', 'Verlauf geleert.');
    }
  });

  vscode.postMessage({ type: 'settings' });
  vscode.postMessage({ type: 'context' });
</script>
</body>
</html>`;
}
