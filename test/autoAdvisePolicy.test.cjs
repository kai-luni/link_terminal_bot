const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutoMessages, extractOpenUserTask, repeatedFailure, shouldAutoAdvise } = require('../out/autoAdvisePolicy.js');
const { AUTO_SYSTEM_PROMPT, SYSTEM_PROMPT, isSilent, renderAutoContext } = require('../out/prompt.js');
const { readTerminalOutput } = require('../out/terminalOutput.js');

const entry = { id: 1, command: 'az group list', exitCode: 7, output: 'Fehler' };

test('C: automatische Hinweise beachten off, errors und always', () => {
  for (const [mode, expected] of [
    ['off', [false, false, false, false]],
    ['errors', [false, true, true, true]],
    ['always', [true, true, true, true]],
  ]) {
    assert.deepEqual([0, 1, -1, undefined].map(code => shouldAutoAdvise(mode, code)), expected);
  }
});

test('C: NICHTS bleibt bei Satzzeichen, Groß-/Kleinschreibung und Leerraum stumm', () => {
  for (const answer of ['', '  \n', 'NICHTS', '  nichts.?! \n', ' **NiChTs** ', '„nichts!“']) {
    assert.equal(isSilent(answer), true, JSON.stringify(answer));
  }
  for (const answer of ['NICHTS weiter', 'Hier ist nichts.', 'az group list']) {
    assert.equal(isSilent(answer), false, answer);
  }
});

test('C: letzte Nutzerfrage wird ohne Terminal-Kontext und mit höchstens 600 Zeichen mitgeschickt', () => {
  const question = 'Letzte Frage: ' + 'x'.repeat(620);
  const history = [
    { role: 'user', content: 'Frühere Frage' },
    { role: 'assistant', content: 'Frühere Antwort' },
    { role: 'user', content: '  ' + question + '\n\n### Terminal-Verlauf\n$ alter Befehl' },
    { role: 'assistant', content: 'Letzte Antwort' },
  ];
  assert.equal(extractOpenUserTask(history).length, 600);
  assert.equal(extractOpenUserTask(history), question.slice(0, 600));
  const messages = buildAutoMessages(entry, [entry], history, 5, 1500, 'Fachwissen');
  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'user']);
  assert.equal(messages[1].content, 'Offene Aufgabe des Nutzers:\n' + question.slice(0, 600));
  assert.match(messages[2].content, /^Gerade beendet:\n\$ az group list   -> exit 7[\s\S]+Fachwissen$/);
  assert.equal(extractOpenUserTask([{ role: 'user', content: 'Frage\n\nGerade beendet:\n$ alt' }]), 'Frage');
});

test('C: ohne Nutzerfrage wird keine Aufgabe-Nachricht angehängt', () => {
  for (const history of [[], [{ role: 'assistant', content: 'Automatischer Hinweis' }], [{ role: 'user', content: '  ' }]]) {
    assert.equal(extractOpenUserTask(history), undefined);
    const messages = buildAutoMessages(entry, [entry], history, 5, 1500);
    assert.deepEqual(messages.map(message => message.role), ['system', 'user']);
    assert.match(messages[1].content, /^Gerade beendet:/);
  }
});

test('C: Prompt fordert einen Zielbefehl ohne Kette oder ein Ergebnis ohne weiteren Befehl', () => {
  assert.match(AUTO_SYSTEM_PROMPT, /Pro Hinweis genau ein Schritt;.*statt eine Kette anzulegen/);
  assert.match(AUTO_SYSTEM_PROMPT, /Zielbefehl statt eines Vorbereitungsschritts/);
  assert.match(AUTO_SYSTEM_PROMPT, /statt eines weiteren az-Befehls das Ergebnis in ein bis drei Sätzen ohne Codeblock/);
});

test('C: Wiederholter Fehler wird trotz Leerraum und Anführungszeichen durch einen Satz ersetzt', () => {
  const failed = { ...entry, command: ' az   group list --query "name"  ' };
  const success = { ...failed, exitCode: 0 };
  const answer = 'Liste abrufen.\n```az\naz group\tlist --query \'name\'\n```';
  const replaced = repeatedFailure(answer, [success, failed]);
  assert.equal(replaced.entry, failed);
  assert.match(replaced.text, /identisch zum vorigen Versuch \(exit 7\)/);
  assert.doesNotMatch(replaced.text, /```|az group/);
  assert.equal(repeatedFailure('az group list --query name', [failed]).entry, failed);
  assert.equal(repeatedFailure(answer, [success, { ...failed, exitCode: undefined }]), undefined);
  assert.equal(repeatedFailure('az group list --query id', [failed]), undefined);
  assert.equal(repeatedFailure('Hier ist das Ergebnis.', [failed]), undefined);
});

test('D: beide Prompts behandeln gekürzte Terminalausgabe als vorhandene Ausgabe', async () => {
  assert.match(SYSTEM_PROMPT, /als gekürzt markiert.*behaupte nie, sie sei leer/);
  assert.match(AUTO_SYSTEM_PROMPT, /als gekürzt markiert.*gilt sie nicht als leer/);
  async function* chunks() {
    yield 'A'.repeat(402);
  }
  const truncated = { ...entry, ...await readTerminalOutput(chunks, 401) };
  const rendered = renderAutoContext(truncated, [truncated], 5, 1500);
  assert.match(rendered, /Ausgabe gekürzt: 1 von 402 Zeichen/);
  assert.doesNotMatch(rendered, /keine Ausgabe/);
  assert.match(renderAutoContext({ ...truncated, output: '' }, [], 5), /\(Ausgabe gekürzt\)/);
  assert.match(renderAutoContext({ ...entry, output: '' }, [], 5), /\(keine Ausgabe\)/);
});
