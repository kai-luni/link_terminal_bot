const test = require('node:test');
const assert = require('node:assert/strict');
const { ChatSession } = require('../out/chatSession.js');
const { SessionContext } = require('../out/sessionContext.js');

const flush = () => new Promise(resolve => setImmediate(resolve));
const command = (id, exitCode = 0) => ({ id, command: `az group show --name gruppe-${id}`, exitCode, output: 'Ausgabe' });

function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const settings = {
    endpoint: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'test-modell',
    apiMode: 'responses',
    webSearch: true,
    webSearchAutoAdvise: false,
    contextCommands: 5,
    contextMaxTokens: 1500,
    autoAdvise: 'always',
    autoAdviseSeconds: 0,
    ...overrides,
  };
  const context = new SessionContext();
  const messages = [];
  const requests = [];
  let active = 0;
  let maxActive = 0;
  const session = new ChatSession({
    context,
    settings: () => settings,
    loadKnowledge: async () => undefined,
    post: message => messages.push(message),
    log: () => {},
    debugLog: () => {},
    request: async options => {
      active++;
      maxActive = Math.max(active, maxActive);
      try {
        return await new Promise((resolve, reject) => requests.push({ options, resolve, reject }));
      } finally {
        active--;
      }
    },
  });
  session.setVisible(true);
  return { session, context, settings, messages, requests, maxActive: () => maxActive };
}

function requestedCommand(request, id) {
  assert.match(request.options.messages.at(-1).content, new RegExp('^Gerade beendet:\\n\\$ .*gruppe-' + id + ' +->'));
}

test('C: Mindestabstand stellt nur den neuesten Befehl zurück und zieht ihn genau einmal nach', async t => {
  const { session, requests, messages } = setup(t, { autoAdviseSeconds: 8 });
  const first = session.autoAdvise(command(1));
  await flush();
  requests[0].resolve('nichts.');
  await first;
  assert.deepEqual(messages, []);

  t.mock.timers.tick(3000);
  await session.autoAdvise(command(2));
  t.mock.timers.tick(2000);
  await session.autoAdvise(command(3));
  t.mock.timers.tick(2999);
  await flush();
  assert.equal(requests.length, 1);

  t.mock.timers.tick(1);
  await flush();
  assert.equal(requests.length, 2);
  requestedCommand(requests[1], 3);
  requests[1].resolve('NICHTS');
  t.mock.timers.tick(8000);
  await flush();
  assert.equal(requests.length, 2);
});

test('C: Modi greifen beim Start eines Hinweises und Einfügen setzt den Mindestabstand zurück', async t => {
  const { session, settings, requests } = setup(t, { autoAdvise: 'off', autoAdviseSeconds: 20 });
  await session.autoAdvise(command(1, 1));
  settings.autoAdvise = 'errors';
  await session.autoAdvise(command(2));
  assert.equal(requests.length, 0);

  const failed = session.autoAdvise(command(3, 1));
  await flush();
  requestedCommand(requests[0], 3);
  requests[0].resolve('NICHTS');
  await failed;
  settings.autoAdvise = 'always';
  session.noteUserAction();
  const success = session.autoAdvise(command(4));
  await flush();
  requestedCommand(requests[1], 4);
  requests[1].resolve('NICHTS');
  await success;
});

test('C: wiederholter Fehler erscheint als Erklärung und der zurückgestellte Hinweis wird nachgezogen', async t => {
  const { session, context, requests, messages } = setup(t);
  context.add({ ...command(1, 5), command: 'az  group show --name "gruppe-1"' });
  const first = session.autoAdvise(context.last);
  await flush();
  await session.autoAdvise(command(2));
  requests[0].resolve('Noch einmal.\n```az\naz group show --name gruppe-1\n```');
  await flush();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'answer');
  assert.equal(messages[0].auto, true);
  assert.match(messages[0].text, /exit 5/);
  assert.doesNotMatch(messages[0].text, /```/);
  assert.equal(requests.length, 2);
  requestedCommand(requests[1], 2);
  requests[1].resolve('NICHTS');
  await first;
});

test('D: laufende Frage sperrt weitere Fragen und stellt den Auto-Hinweis mit der Nutzerfrage zurück', async t => {
  const { session, requests, messages, maxActive } = setup(t);
  const ask = session.ask('Welche Ressource fehlt?');
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.webSearch, true);
  await session.autoAdvise(command(1));
  await session.ask('Parallele Frage');
  assert.equal(requests.length, 1);
  assert.deepEqual(messages, [
    { type: 'busy', busy: true },
    { type: 'error', text: 'Es läuft noch eine Antwort. Bitte kurz warten.' },
  ]);

  requests[0].options.onWebSearchUsage({ used: true, requests: 3 });
  requests[0].resolve('Die Antwort');
  await ask;
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(maxActive(), 1);
  requestedCommand(requests[1], 1);
  assert.equal(requests[1].options.webSearch, false);
  assert.deepEqual(requests[1].options.messages[1], {
    role: 'user',
    content: 'Offene Aufgabe des Nutzers:\nWelche Ressource fehlt?',
  });
  assert.deepEqual(messages.slice(2), [
    { type: 'searchUsage', count: 3 },
    { type: 'answer', text: 'Die Antwort' },
    { type: 'busy', busy: false },
  ]);
  requests[1].resolve('NICHTS');
  await flush();
});

test('D: Nutzerfrage wartet auf eine alte Auto-Anfrage und verwirft deren Antwort', async t => {
  const { session, requests, messages, maxActive } = setup(t);
  const auto = session.autoAdvise(command(1));
  await flush();
  const ask = session.ask('Manuelle Frage');
  await session.autoAdvise(command(2));
  await flush();
  assert.equal(requests.length, 1);
  assert.deepEqual(messages, [{ type: 'busy', busy: true }]);
  requests[0].resolve('Diese Auto-Antwort ist veraltet');
  await auto;
  await flush();
  assert.equal(requests.length, 2);
  assert.doesNotMatch(JSON.stringify(requests[1].options.messages), /veraltet/);
  assert.deepEqual(messages, [{ type: 'busy', busy: true }]);

  requests[1].resolve('Manuelle Antwort');
  await ask;
  await flush();
  assert.equal(requests.length, 3);
  assert.equal(maxActive(), 1);
  requestedCommand(requests[2], 2);
  requests[2].resolve('Neuer Hinweis');
  await flush();
  assert.deepEqual(messages.filter(message => message.type === 'answer').map(message => message.text),
    ['Manuelle Antwort', 'Neuer Hinweis']);
});

test('D: abgelaufener Timer wartet bei besetzter Sperre und verliert den Eintrag nicht', async t => {
  const { session, requests, maxActive } = setup(t, { autoAdviseSeconds: 8 });
  const first = session.autoAdvise(command(1));
  await flush();
  requests[0].resolve('NICHTS');
  await first;
  await session.autoAdvise(command(2));
  const ask = session.ask('Eine Frage');
  await flush();
  t.mock.timers.tick(8000);
  await flush();
  assert.equal(requests.length, 2);
  requests[1].reject(new Error('Verbindung unterbrochen'));
  await ask;
  await flush();
  assert.equal(requests.length, 3);
  assert.equal(maxActive(), 1);
  requestedCommand(requests[2], 2);
  requests[2].resolve('NICHTS');
  await flush();
});

test('D: abgeschlossene Fragen hängen sich an den bestehenden Verlauf an', async t => {
  const { session, requests } = setup(t);
  const turns = [
    ['Erste Frage', 'Erste Antwort'],
    ['Zweite Frage', 'Zweite Antwort'],
    ['Dritte Frage', 'Dritte Antwort'],
  ];
  for (const [question, answer] of turns) {
    const ask = session.ask(question);
    await flush();
    requests.at(-1).resolve(answer);
    await ask;
  }
  assert.deepEqual(requests[2].options.messages.slice(1, -1), [
    { role: 'user', content: 'Erste Frage' },
    { role: 'assistant', content: 'Erste Antwort' },
    { role: 'user', content: 'Zweite Frage' },
    { role: 'assistant', content: 'Zweite Antwort' },
  ]);
  assert.match(requests[2].options.messages.at(-1).content, /^Dritte Frage\n\n### Terminal-Verlauf/);
});

test('D: Verlauf löschen verhindert, dass eine alte Frage oder ihre Antwort zurückkehrt', async t => {
  const { session, requests, messages } = setup(t);
  const ask = session.ask('Alte Frage');
  await flush();
  session.clearHistory();
  requests[0].options.onWebSearchUsage({ used: true, requests: 2 });
  requests[0].resolve('Alte Antwort');
  await ask;
  assert.deepEqual(messages, [{ type: 'busy', busy: true }, { type: 'cleared' }, { type: 'busy', busy: false }]);

  const next = session.ask('Neue Frage');
  await flush();
  assert.deepEqual(requests[1].options.messages.map(message => message.role), ['system', 'user']);
  assert.match(requests[1].options.messages[1].content, /^Neue Frage/);
  requests[1].resolve('Neue Antwort');
  await next;
  assert.deepEqual(messages.filter(message => message.type === 'answer'), [{ type: 'answer', text: 'Neue Antwort' }]);
});

test('D: Schließen räumt den Timer ab und startet keine neuen Anfragen ohne sichtbare Ansicht', async t => {
  const { session, requests } = setup(t, { autoAdviseSeconds: 8 });
  const running = session.autoAdvise(command(1));
  await flush();
  requests[0].resolve('NICHTS');
  await running;
  await session.autoAdvise(command(2));
  session.setVisible(false);
  await session.autoAdvise(command(3));

  // Auch ein Wiederöffnen vor Ablauf darf den alten Timer nicht reaktivieren.
  session.setVisible(true);
  t.mock.timers.tick(20_000);
  await flush();
  assert.equal(requests.length, 1);
  const fresh = session.autoAdvise(command(4));
  await flush();
  assert.equal(requests.length, 2);
  requestedCommand(requests[1], 4);
  requests[1].resolve('NICHTS');
  await fresh;
});

test('D: Schließen während einer Auto-Anfrage verhindert eine wartende Frage und die alte Auto-Antwort', async t => {
  const { session, requests, messages } = setup(t);
  const running = session.autoAdvise(command(1));
  await flush();
  const ask = session.ask('Noch nicht gesendet');
  session.setVisible(false);
  requests[0].resolve('Alter Hinweis');
  await running;
  await ask;
  assert.equal(requests.length, 1);
  assert.deepEqual(messages, [{ type: 'busy', busy: true }, { type: 'busy', busy: false }]);
});
