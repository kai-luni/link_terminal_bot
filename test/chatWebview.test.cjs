const test = require('node:test');
const assert = require('node:assert/strict');
const { webviewConfigMessage } = require('../out/chatSettings.js');
const { renderHtml } = require('../out/chatWebview.js');
const { formatContextStatus } = require('../out/statusText.js');

const settings = {
  model: 'test-modell',
  endpoint: 'https://example.test/v1',
  apiKey: 'privater-schluessel',
  apiMode: 'responses',
  webSearch: true,
  webSearchAutoAdvise: false,
  contextCommands: 5,
  contextMaxTokens: 1500,
  autoAdvise: 'errors',
  autoAdviseSeconds: 8,
};
const status = { count: 2, totalCount: 6, tokens: 233 };

function openWebview(html, initialState) {
  const elements = new Map();
  const windowEvents = new Map();
  const messages = [];
  let state = initialState;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const events = new Map();
        elements.set(id, {
          textContent: '',
          open: false,
          addEventListener: (name, handler) => events.set(name, handler),
          dispatch: name => events.get(name)(),
        });
      }
      return elements.get(id);
    },
  };
  const window = { addEventListener: (name, handler) => windowEvents.set(name, handler) };
  const api = {
    postMessage: message => messages.push(message),
    getState: () => state,
    setState: value => { state = value; },
  };
  const script = html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)[1];
  new Function('document', 'window', 'acquireVsCodeApi', script)(document, window, () => api);
  return {
    element: id => document.getElementById(id),
    receive: data => windowEvents.get('message')({ data }),
    state: () => state,
    messages,
  };
}

test('B: Status formatiert zugeklappt und aufgeklappt Befehle, Modell, Endpoint und Tokens', () => {
  assert.deepEqual(formatContextStatus(status, settings), {
    summary: 'Kontext · 2 Befehle · 233 / 1.5k Tokens',
    model: settings.model,
    endpoint: settings.endpoint,
    commands: '2 von 6 (Limit 5)',
    budget: '1500 Tokens',
    tokens: '233 Tokens',
  });
  const single = formatContextStatus({ count: 1, totalCount: 1, tokens: 1000 }, { ...settings, model: '', endpoint: ' ' });
  assert.equal(single.summary, 'Kontext · 1 Befehl · 1k / 1.5k Tokens');
  assert.equal(single.commands, '1 (Limit 5)');
  assert.equal(single.model, '(nicht gesetzt)');
  assert.equal(single.endpoint, '(nicht gesetzt)');
});

test('B: Webview aktualisiert die Statuszeile und merkt sich den offenen und geschlossenen Zustand', () => {
  const html = renderHtml({ cspSource: 'vscode-webview:' }, settings);
  const first = openWebview(html, { andererWert: 42 });
  assert.deepEqual(first.messages, [{ type: 'settings' }, { type: 'context' }]);
  assert.equal(first.element('ctxDetails').open, false);
  first.receive({
    type: 'context',
    ...status,
    maxTokens: 2000,
    contextCommands: 4,
    endpoint: 'https://neu.example.test/v1',
    model: 'neues-modell',
  });
  assert.deepEqual(['ctxSummary', 'dModel', 'dEndpoint', 'dCommands', 'dBudget', 'dTokens']
    .map(id => first.element(id).textContent), [
    'Kontext · 2 Befehle · 233 / 2k Tokens',
    'neues-modell',
    'https://neu.example.test/v1',
    '2 von 6 (Limit 4)',
    '2000 Tokens',
    '233 Tokens',
  ]);
  first.element('ctxDetails').open = true;
  first.element('ctxDetails').dispatch('toggle');
  assert.deepEqual(first.state(), { andererWert: 42, detailsOpen: true });

  const reopened = openWebview(html, first.state());
  assert.equal(reopened.element('ctxDetails').open, true);
  reopened.element('ctxDetails').open = false;
  reopened.element('ctxDetails').dispatch('toggle');
  assert.deepEqual(reopened.state(), { andererWert: 42, detailsOpen: false });
  assert.equal(openWebview(html, reopened.state()).element('ctxDetails').open, false);
});

test('E: Konfigurationsnachricht und initiales HTML enthalten den API-Key nicht', () => {
  const config = webviewConfigMessage(settings);
  assert.deepEqual(config, {
    type: 'config',
    settings: {
      model: settings.model,
      endpoint: settings.endpoint,
      apiMode: settings.apiMode,
      webSearch: settings.webSearch,
      contextCommands: settings.contextCommands,
      contextMaxTokens: settings.contextMaxTokens,
    },
  });
  assert.ok(!JSON.stringify(config).includes(settings.apiKey));
  const html = renderHtml({ cspSource: 'vscode-webview:' }, settings);
  assert.ok(!html.includes(settings.apiKey));
});
