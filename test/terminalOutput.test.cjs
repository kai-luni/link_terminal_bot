const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_WATCHED_COMMANDS,
  isWatched,
  readTerminalOutput,
} = require('../out/terminalOutput.js');
const properties = require('../package.json').contributes.configuration.properties;

async function* stream(...chunks) {
  yield* chunks;
}

test('A: watchedCommands filtert nach dem Kommando hinter sudo und &', () => {
  assert.deepEqual(DEFAULT_WATCHED_COMMANDS, ['az', 'azd']);
  assert.deepEqual(properties['linkTerminalBot.watchedCommands'].default, DEFAULT_WATCHED_COMMANDS);
  for (const command of ['az group list', 'azd up', '  sudo\taz group list', '& az account show', 'sudo & azd up']) {
    assert.equal(isWatched(command, DEFAULT_WATCHED_COMMANDS), true, command);
  }
  for (const command of ['', 'sudo', '&', 'azcopy list', 'echo az', 'sudo ls', '& git status']) {
    assert.equal(isWatched(command, DEFAULT_WATCHED_COMMANDS), false, command);
  }
  assert.equal(isWatched('& git status', ['git']), true);
  assert.equal(isWatched('az group list', ['git']), false);
  assert.equal(isWatched('az account show', []), false);
});

test('A: Standardlimit 8000 behält 30 % am Anfang und den Rest am Ende des Streams', async () => {
  assert.equal(DEFAULT_MAX_OUTPUT_CHARS, 8000);
  assert.equal(properties['linkTerminalBot.maxOutputChars'].default, DEFAULT_MAX_OUTPUT_CHARS);
  const head = 'A'.repeat(2400);
  const tail = 'Z'.repeat(5600);
  const result = await readTerminalOutput(() => stream(head.slice(0, 700), head.slice(700) + 'M'.repeat(2000), tail));
  assert.deepEqual(result, {
    output: head + '\n[... Ausgabe gekürzt: 2000 von 10000 Zeichen in der Mitte weggelassen ...]\n' + tail,
    omittedChars: 2000,
  });
});

test('A: kleines Limit behält mindestens 400 Zeichen am Anfang und misst ungetrimmte Längen', async () => {
  const head = 'A'.repeat(399) + '\n';
  const tail = ' ' + 'Z'.repeat(99);
  const result = await readTerminalOutput(() => stream(head, 'M'.repeat(35), tail.slice(0, 70), tail.slice(70)), 500);
  assert.deepEqual(result, {
    output: head.trimEnd() + '\n[... Ausgabe gekürzt: 35 von 535 Zeichen in der Mitte weggelassen ...]\n' + tail.trimStart(),
    omittedChars: 35,
  });
  const minimum = await readTerminalOutput(() => stream(head + 'M'), 1);
  assert.equal(minimum.omittedChars, 1);
  assert.match(minimum.output, /^A{399}\n\[\.\.\. Ausgabe gekürzt: 1 von 401 Zeichen/);
});

test('A: kurze Ausgabe mit 36 Zeichen und Ausgabe genau am Limit bekommen keinen Kürzungsmarker', async () => {
  const short = 'x'.repeat(35) + '\n';
  assert.equal(short.length, 36);
  assert.deepEqual(await readTerminalOutput(() => stream(short)), { output: short.trimEnd() });
  assert.deepEqual(await readTerminalOutput(() => stream(short), NaN), { output: short.trimEnd() });
  const exact = 'E'.repeat(8000);
  assert.deepEqual(await readTerminalOutput(() => stream(exact.slice(0, 4000), exact.slice(4000))), { output: exact });
  const fallback = await readTerminalOutput(() => stream(exact + 'E'), NaN);
  assert.equal(fallback.omittedChars, 1);
  assert.match(fallback.output, /1 von 8001 Zeichen/);
});

test('A: Lesefehler erhält Teilausgabe und markiert sie als unvollständig', async () => {
  const error = new Error('Terminal geschlossen');
  async function* interrupted() {
    yield 'Erste Zeile\n';
    yield 'Zweiter Teil';
    throw error;
  }
  const errors = [];
  assert.deepEqual(await readTerminalOutput(interrupted, 8000, err => errors.push(err)), {
    output: '[Ausgabe unvollständig: Error: Terminal geschlossen]\nErste Zeile\nZweiter Teil',
  });
  assert.deepEqual(errors, [error]);
  assert.deepEqual(await readTerminalOutput(() => { throw error; }), {
    output: '[Ausgabe unvollständig: Error: Terminal geschlossen]',
  });
});
