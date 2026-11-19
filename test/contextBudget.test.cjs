const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateTokens, renderContext, summarizeContext } = require('../out/contextBudget.js');
const { SessionContext } = require('../out/sessionContext.js');

const oldest = { id: 1, command: 'az group list', exitCode: 0, output: 'Älteste Ausgabe' };
const middle = { id: 2, command: 'az account show', exitCode: 1, output: 'Erste Zeile\nZweite Zeile' };
const newest = { id: 3, command: 'azd up', exitCode: undefined, output: 'Neueste Ausgabe' };
const history = [oldest, middle, newest];
const expected = [
  '### Terminal-Verlauf (letzte 2, neueste zuletzt)',
  '$ az account show   -> exit 1',
  'Erste Zeile\nZweite Zeile',
  '',
  '$ azd up   -> exit ?',
  'Neueste Ausgabe',
].join('\n');

test('B: Anzahl und Token-Budget begrenzen den Kontext unabhängig voneinander auf die neuesten Befehle', () => {
  const tokens = Math.ceil(expected.length / 4);
  const want = { text: expected, includedCount: 2, totalCount: 3, tokens };
  assert.deepEqual(summarizeContext(history, 2, Infinity), want);
  assert.deepEqual(summarizeContext(history, 3, tokens), want);
  assert.deepEqual(summarizeContext(history, 2, tokens), want);
  assert.equal(renderContext(history, 3, tokens), expected);
  assert.equal(summarizeContext(history, 1, Infinity).includedCount, 1);
  assert.equal(summarizeContext(history, 3, tokens - 1).includedCount, 1);
  assert.equal(estimateTokens('12345'), 2);
});

test('B: FIFO überspringt keinen teuren neueren Befehl, um einen älteren unterzubringen', () => {
  const largeMiddle = { ...middle, output: 'M'.repeat(1000) };
  const budget = summarizeContext([oldest, newest], 3).tokens;
  const summary = summarizeContext([oldest, largeMiddle, newest], 3, budget);
  assert.equal(summary.includedCount, 1);
  assert.match(summary.text, /Neueste Ausgabe/);
  assert.doesNotMatch(summary.text, /Älteste Ausgabe|MMM/);
});

test('B: Neuester Befehl bleibt bei überschrittenem Budget vollständig erhalten', () => {
  const output = 'Anfang\n' + 'D'.repeat(500) + '\nEnde';
  const summary = summarizeContext([oldest, { ...newest, output }], 5, 0);
  assert.equal(summary.text, '### Terminal-Verlauf (letzte 1, neueste zuletzt)\n$ azd up   -> exit ?\n' + output);
  assert.equal(summary.includedCount, 1);
  assert.equal(summary.tokens, Math.ceil(summary.text.length / 4));
  assert.ok(summary.tokens > 0);
});

test('B: leerer Verlauf liefert den Hinweistext und belegt keine Tokens', () => {
  assert.deepEqual(summarizeContext([], 5, 1500), {
    text: '### Terminal-Verlauf\n(noch keine Befehle mitgelesen)',
    includedCount: 0,
    totalCount: 0,
    tokens: 0,
  });
  assert.equal(renderContext([], 5, 1500), '### Terminal-Verlauf\n(noch keine Befehle mitgelesen)');
});

test('B: Sitzungskontext verwirft den ältesten Eintrag und lässt sich leeren', () => {
  const context = new SessionContext();
  for (const entry of history) {
    context.add(entry, 2);
  }
  assert.deepEqual(context.all, [middle, newest]);
  assert.equal(context.last, newest);
  context.clear();
  assert.deepEqual(context.all, []);
  assert.equal(context.last, undefined);
});
