import * as crypto from 'crypto';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { ChatApiMode, ChatMessage, chatCompletion } from './llmClient';
import {
  KNOWLEDGE_FILE_NAME,
  loadKnowledge,
  renderKnowledge,
} from './knowledge';
import {
  AUTO_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  isSilent,
  renderAutoContext,
  renderContext,
  summarizeContext,
} from './prompt';
import { SessionContext } from './sessionContext';
import { TerminalCommandEntry } from './types';

export type AutoAdviseMode = 'off' | 'errors' | 'always';

export interface ChatSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  apiMode: ChatApiMode;
  webSearch: boolean;
  webSearchAutoAdvise: boolean;
  contextCommands: number;
  contextMaxTokens: number;
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
  private historyEpoch = 0;
  private lastAutoAt = 0;
  /** Läuft gerade eine Anfrage? `ask` und `autoAdvise` teilen sich diese Sperre. */
  private inFlight: 'ask' | 'auto' | null = null;
  /** Kennung des laufenden Auto-Laufs — wird ungültig, sobald eine Frage startet. */
  private autoRun: object | null = null;
  private pendingEntry: TerminalCommandEntry | undefined;
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly context: SessionContext,
    private readonly settings: () => ChatSettings,
    private readonly insertCommand: (command: string) => void,
    private readonly log: (message: string) => void = () => {},
    private readonly debugLog: (type: string, data: unknown) => void = () => {},
  ) {}

  /** Nach einem Einfügen aus dem Chat: der nächste Befehl ist die Folge unseres Vorschlags. */
  noteUserAction(): void {
    this.lastAutoAt = 0;
    this.log('Befehl aus dem Chat eingefügt — der nächste Hinweis kommt ohne Wartezeit.');
    this.debugLog('AUTO_COOLDOWN_RESET', 'Einfügen aus dem Chat');
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderHtml(view.webview, this.settings());
    view.onDidDispose(() => {
      this.view = undefined;
      // Kein Timer darf nach dem Schließen noch eine (bezahlte) Anfrage auslösen.
      if (this.cooldownTimer) {
        clearTimeout(this.cooldownTimer);
        this.cooldownTimer = undefined;
      }
      this.pendingEntry = undefined;
      this.debugLog('VIEW_CLOSED', 'Chat-Ansicht geschlossen.');
    });
    view.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message));
    this.debugLog('VIEW_OPENED', { modell: this.settings().model });
  }

  /**
   * Reagiert von sich aus auf einen beendeten Befehl — oder schweigt.
   * Nur wenn das Modell es für nötig hält, landet eine Nachricht im Chat.
   */
  async autoAdvise(entry: TerminalCommandEntry, skipCooldown = false): Promise<void> {
    const settings = this.settings();
    if (settings.autoAdvise === 'off') {
      return;
    }
    const failed = entry.exitCode === undefined || entry.exitCode !== 0;
    if (settings.autoAdvise === 'errors' && !failed) {
      this.debugLog('AUTO_SKIP', { grund: 'Modus errors, Befehl war erfolgreich', entry });
      return;
    }
    if (this.inFlight !== null) {
      // Läuft noch eine Anfrage (Frage oder anderer Hinweis): den Befehl nicht verlieren, sondern nachziehen.
      this.pendingEntry = entry;
      this.log(`[${entry.id}] Hinweis zurückgestellt — es läuft noch eine Anfrage.`);
      this.debugLog('AUTO_DEFER', { entry });
      return;
    }
    const cooldownMs = Math.max(0, settings.autoAdviseSeconds) * 1000;
    const elapsed = Date.now() - this.lastAutoAt;
    if (!skipCooldown && elapsed < cooldownMs) {
      // Mindestabstand noch nicht um: genau einen Eintrag merken und nach Ablauf nachziehen.
      const remainingMs = cooldownMs - elapsed;
      this.pendingEntry = entry;
      if (this.cooldownTimer) {
        clearTimeout(this.cooldownTimer);
      }
      this.cooldownTimer = setTimeout(() => {
        this.cooldownTimer = undefined;
        const deferred = this.pendingEntry;
        this.pendingEntry = undefined;
        if (deferred) {
          void this.autoAdvise(deferred, true);
        }
      }, remainingMs);
      this.log(
        `[${entry.id}] Hinweis zurückgestellt — Mindestabstand ${settings.autoAdviseSeconds}s noch nicht um (${Math.round(elapsed / 1000)}s vergangen, Nachzug in ${Math.ceil(remainingMs / 1000)}s).`,
      );
      this.debugLog('AUTO_DEFER', {
        grund: 'Mindestabstand noch nicht um',
        vergangenSekunden: Math.round(elapsed / 1000),
        restMs: remainingMs,
        einstellungSekunden: settings.autoAdviseSeconds,
        entry,
      });
      return;
    }

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
      this.pendingEntry = undefined;
    }

    const autoRun = {};
    this.autoRun = autoRun;
    this.inFlight = 'auto';
    this.lastAutoAt = Date.now();
    const knowledge = await this.loadKnowledge();
    const messages = [
      { role: 'system' as const, content: AUTO_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: renderAutoContext(entry, this.context.all, settings.contextCommands, settings.contextMaxTokens) +
          (knowledge ? `\n\n${knowledge}` : ''),
      },
    ];
    this.debugLog('AUTO_REQUEST', { model: settings.model, entry, messages });

    try {
      const answer = await chatCompletion({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
        apiMode: settings.apiMode,
        webSearch: settings.webSearch && settings.webSearchAutoAdvise,
        onWebSearchUsage: usage => this.debugLog('AUTO_WEB_SEARCH_USAGE', { entryId: entry.id, ...usage }),
      });
      const silent = isSilent(answer);
      this.debugLog('AUTO_ANSWER', { entryId: entry.id, silent, answer });
      if (this.autoRun !== autoRun || this.inFlight !== 'auto') {
        // Zwischenzeitlich wurde eine Frage gestellt: die Antwort gehört zu einem alten Strang.
        this.log(`[${entry.id}] automatischer Hinweis verworfen — es wurde zwischenzeitlich gefragt.`);
        this.debugLog('AUTO_DROP', { entryId: entry.id, answer });
        return;
      }
      if (silent) {
        this.log(`[${entry.id}] $ ${entry.command} -> exit ${entry.exitCode ?? '?'}: kein Hinweis`);
      } else {
        this.history.push({ role: 'assistant', content: answer });
        this.post({
          type: 'answer',
          text: answer,
          auto: true,
          label: `automatisch · $ ${entry.command} (exit ${entry.exitCode ?? '?'})`,
        });
        this.log(`[${entry.id}] automatischer Hinweis: ${answer.split('\n')[0]}`);
      }
    } catch (err) {
      // Ein automatischer Hinweis darf den Ablauf nicht stören — nur ins Log.
      this.log(`[${entry.id}] automatischer Hinweis fehlgeschlagen: ${String(err)}`);
      this.debugLog('AUTO_ERROR', { entryId: entry.id, fehler: String(err) });
      this.lastAutoAt = 0;
    } finally {
      if (this.autoRun === autoRun) {
        this.autoRun = null;
      }
      if (this.inFlight === 'auto') {
        this.inFlight = null;
      }
    }

    if (this.inFlight !== null) {
      // Eine Frage hat übernommen; sie zieht zurückgestellte Befehle selbst nach.
      return;
    }
    const deferred = this.pendingEntry;
    this.pendingEntry = undefined;
    if (deferred) {
      await this.autoAdvise(deferred, true);
    }
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
      this.history = [];
      this.historyEpoch += 1;
      this.post({ type: 'cleared' });
      return;
    }
    if (type === 'settings') {
      // Den API-Schlüssel niemals an die Webview weiterreichen.
      const { model, endpoint, apiMode, webSearch, contextCommands, contextMaxTokens } = this.settings();
      this.post({
        type: 'config',
        settings: { model, endpoint, apiMode, webSearch, contextCommands, contextMaxTokens },
      });
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

    const question = text.trim();
    if (this.inFlight === 'ask') {
      this.log('Frage ignoriert — die vorige Antwort läuft noch.');
      this.post({ type: 'error', text: 'Es läuft noch eine Antwort. Bitte kurz warten.' });
      return;
    }
    const settings = this.settings();
    // Die Frage übernimmt die Sperre; ein laufender Auto-Hinweis wird damit ungültig.
    this.autoRun = null;
    this.inFlight = 'ask';
    const epoch = this.historyEpoch;
    const previous = this.history;
    this.post({ type: 'busy', busy: true });
    const knowledge = await this.loadKnowledge();
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...previous,
      {
        role: 'user',
        content: `${question}\n\n${renderContext(this.context.all, settings.contextCommands, settings.contextMaxTokens)}${knowledge ? `\n\n${knowledge}` : ''}`,
      },
    ];
    this.debugLog('ASK', { model: settings.model, frage: question, messages });

    try {
      const answer = await chatCompletion({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
        apiMode: settings.apiMode,
        webSearch: settings.webSearch,
        onWebSearchUsage: usage => {
          this.debugLog('WEB_SEARCH_USAGE', { frage: question, ...usage });
          if (usage.used) {
            this.post({ type: 'searchUsage', count: usage.requests });
          }
        },
      });
      this.debugLog('ANSWER', { frage: question, answer });
      if (this.historyEpoch === epoch) {
        this.history = [
          ...this.history,
          { role: 'user', content: question },
          { role: 'assistant', content: answer },
        ];
      }
      this.post({ type: 'answer', text: answer });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.debugLog('ERROR', { frage: question, fehler: message });
      this.post({ type: 'error', text: message });
    } finally {
      this.inFlight = null;
      this.post({ type: 'busy', busy: false });
      const deferred = this.pendingEntry;
      this.pendingEntry = undefined;
      if (deferred) {
        void this.autoAdvise(deferred, true);
      }
    }
  }
}

export function renderHtml(webview: vscode.Webview, settings: ChatSettings): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const initialConfig = {
    model: settings.model,
    endpoint: settings.endpoint,
    contextCommands: settings.contextCommands,
    contextMaxTokens: settings.contextMaxTokens,
  };

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
  .err { border-left: 2px solid var(--vscode-errorForeground); color: var(--vscode-errorForeground); white-space: pre-wrap; word-break: break-word; }
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
  .ins:disabled { opacity: 1; cursor: default; }
  .cmd.done { border-left: 2px solid var(--vscode-charts-green, #3fb950); padding-left: 4px; }
  .cmd.done code { opacity: 0.65; }
  .ins.done {
    background: transparent;
    color: var(--vscode-charts-green, #3fb950);
  }
  .plain { white-space: pre-wrap; word-break: break-word; }
  .plain code { background: var(--vscode-textCodeBlock-background); padding: 0 3px; }
  .plain a { color: var(--vscode-textLink-foreground); }
  .typing { color: var(--vscode-descriptionForeground); font-style: italic; }
  .dots span { animation: blink 1.2s infinite; }
  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 20% { opacity: 0.15; } 50% { opacity: 1; } 100% { opacity: 0.15; } }
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
  #bar {
    padding: 2px 8px 4px 8px;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
  }
  #status {
    padding: 0 0 2px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #status:empty { display: none; }
  #ctxDetails summary {
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #ctxBody {
    margin-top: 4px;
    padding-left: 12px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
  }
  #ctxBody .lbl { opacity: 0.8; }
  #ctxBody .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
</head>
<body>
<div id="log"></div>
<div id="bar">
  <div class="meta" id="status"></div>
  <details id="ctxDetails">
    <summary id="ctxSummary">Kontext · 0 Befehle · 0 Tokens</summary>
    <div id="ctxBody">
      <span class="lbl">Modell</span><span class="val" id="dModel"></span>
      <span class="lbl">Endpoint</span><span class="val" id="dEndpoint"></span>
      <span class="lbl">Befehle im Kontext</span><span class="val" id="dCommands"></span>
      <span class="lbl">Token-Budget</span><span class="val" id="dBudget"></span>
      <span class="lbl">Belegte Tokens</span><span class="val" id="dTokens"></span>
    </div>
  </details>
</div>
<div id="row">
  <textarea id="input" placeholder="Was ist das Problem? (Enter = senden, Shift+Enter = neue Zeile)"></textarea>
  <button id="send">Senden</button>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const FENCE = String.fromCharCode(96, 96, 96);
  const TICK = String.fromCharCode(96);

  // Fehler in der Ansicht an die Extension melden, damit sie im Log landen.
  window.onerror = function (message, source, line, column, error) {
    vscode.postMessage({
      type: 'webviewError',
      text: String(message) + ' (' + String(source) + ':' + line + ':' + column + ')',
      stack: error && error.stack ? String(error.stack) : null,
    });
    return false;
  };
  window.addEventListener('unhandledrejection', function (event) {
    vscode.postMessage({
      type: 'webviewError',
      text: 'unhandled rejection: ' + String(event.reason && event.reason.message ? event.reason.message : event.reason),
      stack: event.reason && event.reason.stack ? String(event.reason.stack) : null,
    });
  });
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const status = document.getElementById('status');
  const ctxDetails = document.getElementById('ctxDetails');
  const ctxSummary = document.getElementById('ctxSummary');
  const dModel = document.getElementById('dModel');
  const dEndpoint = document.getElementById('dEndpoint');
  const dCommands = document.getElementById('dCommands');
  const dBudget = document.getElementById('dBudget');
  const dTokens = document.getElementById('dTokens');
  const cfg = ${JSON.stringify(initialConfig)};
  let ctxState = { count: 0, totalCount: 0, tokens: 0 };
  let initial = endpointHint(cfg.endpoint);
  let busy = false;
  let statusTimer = null;

  function endpointHint(endpoint) {
    return endpoint && endpoint.trim().length > 0
      ? ''
      : 'Kein Endpunkt gesetzt: linkTerminalBot.chatEndpoint in den Einstellungen füllen.';
  }

  function formatTokens(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\\.0$/, '') + 'k' : String(n);
  }

  function renderStatusBar() {
    const unit = ctxState.count === 1 ? 'Befehl' : 'Befehle';
    ctxSummary.textContent = 'Kontext · ' + ctxState.count + ' ' + unit + ' · ' + formatTokens(ctxState.tokens) + ' Tokens';
    dModel.textContent = cfg.model || '(nicht gesetzt)';
    dEndpoint.textContent = cfg.endpoint && cfg.endpoint.trim().length > 0 ? cfg.endpoint : '(nicht gesetzt)';
    dCommands.textContent = ctxState.totalCount > ctxState.count
      ? ctxState.count + ' von ' + ctxState.totalCount + ' (Limit ' + cfg.contextCommands + ')'
      : ctxState.count + ' (Limit ' + cfg.contextCommands + ')';
    dBudget.textContent = cfg.contextMaxTokens + ' Tokens';
    dTokens.textContent = ctxState.tokens + ' Tokens';
  }

  // Aufklapp-Zustand der Statusleiste zwischen Panel-Wechseln merken.
  const savedState = vscode.getState() || {};
  if (savedState.detailsOpen === true) {
    ctxDetails.open = true;
  }
  ctxDetails.addEventListener('toggle', () => {
    const prev = vscode.getState() || {};
    vscode.setState(Object.assign({}, prev, { detailsOpen: ctxDetails.open }));
  });
  renderStatusBar();

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
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'insert', command: line });
      // Sofort sichtbar machen, dass dieser Befehl schon eingefügt wurde.
      row.classList.add('done');
      btn.classList.add('done');
      btn.textContent = '✓ eingefügt';
      btn.disabled = true;
      btn.title = 'Bereits ins Terminal eingefügt';
    });
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

  // "schreibt …" solange eine Antwort unterwegs ist.
  function showTyping() {
    if (document.getElementById('typing')) { return; }
    const el = append(true);
    el.id = 'typing';
    el.className = 'msg bot typing';
    el.textContent = 'schreibt';
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.innerHTML = '<span>.</span><span>.</span><span>.</span>';
    el.appendChild(dots);
  }
  function hideTyping() {
    const el = document.getElementById('typing');
    if (el) { el.remove(); }
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
          const source = line.match(/^(.*?)(https?:\\/\\/\\S+)$/);
          if (source) {
            const heading = document.createElement('span');
            heading.innerHTML = fmt(source[1]);
            const link = document.createElement('a');
            link.href = source[2];
            link.textContent = source[2];
            link.addEventListener('click', (event) => {
              event.preventDefault();
              vscode.postMessage({ type: 'openExternal', text: source[2] });
            });
            el.appendChild(heading);
            el.appendChild(link);
          } else {
            el.innerHTML = fmt(line);
          }
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
      hideTyping();
      if (msg.auto) { addPlain('meta', msg.label || 'automatischer Hinweis'); }
      addRich(msg.text);
    } else if (msg.type === 'searchUsage') {
      const number = msg.count;
      addPlain('meta', (typeof number === 'number')
        ? 'Websuche verwendet: ' + number + ' Suchanfrage(n)'
        : 'Websuche verwendet (Anzahl nicht übermittelt)');
    } else if (msg.type === 'error') {
      hideTyping();
      addPlain('err', 'Fehler: ' + msg.text);
    } else if (msg.type === 'busy') {
      setBusy(!!msg.busy);
      if (msg.busy) { showTyping(); } else { hideTyping(); }
    } else if (msg.type === 'config' && msg.settings) {
      Object.assign(cfg, msg.settings);
      initial = endpointHint(cfg.endpoint);
      if (!busy && !statusTimer) { status.textContent = initial; }
      renderStatusBar();
    } else if (msg.type === 'context') {
      ctxState = {
        count: typeof msg.count === 'number' ? msg.count : 0,
        totalCount: typeof msg.totalCount === 'number' ? msg.totalCount : 0,
        tokens: typeof msg.tokens === 'number' ? msg.tokens : 0,
      };
      if (typeof msg.maxTokens === 'number') { cfg.contextMaxTokens = msg.maxTokens; }
      if (typeof msg.contextCommands === 'number') { cfg.contextCommands = msg.contextCommands; }
      if (typeof msg.model === 'string') { cfg.model = msg.model; }
      if (typeof msg.endpoint === 'string') {
        cfg.endpoint = msg.endpoint;
        initial = endpointHint(cfg.endpoint);
        if (!busy && !statusTimer) { status.textContent = initial; }
      }
      renderStatusBar();
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
