import * as crypto from 'crypto';
import { ChatSettings } from './chatSettings';
import { formatContextStatus } from './statusText';

export function renderHtml(webview: { cspSource: string }, settings: ChatSettings): string {
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
  const cfg = ${JSON.stringify(initialConfig).replace(/</g, '\\u003c')};
  const formatContextStatus = ${formatContextStatus.toString()};
  let ctxState = { count: 0, totalCount: 0, tokens: 0 };
  let initial = endpointHint(cfg.endpoint);
  let busy = false;
  let statusTimer = null;

  function endpointHint(endpoint) {
    return endpoint && endpoint.trim().length > 0
      ? ''
      : 'Kein Endpunkt gesetzt: linkTerminalBot.chatEndpoint in den Einstellungen füllen.';
  }

  function renderStatusBar() {
    const text = formatContextStatus(ctxState, cfg);
    ctxSummary.textContent = text.summary;
    dModel.textContent = text.model;
    dEndpoint.textContent = text.endpoint;
    dCommands.textContent = text.commands;
    dBudget.textContent = text.budget;
    dTokens.textContent = text.tokens;
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
