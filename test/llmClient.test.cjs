const test = require('node:test');
const assert = require('node:assert/strict');
const { chatCompletion, describeFetchFailure, resolveEndpoint, extractResponsesAnswer } = require('../out/llmClient.js');
const messages = [
  { role: 'system', content: 'Du bist ein Terminalhelfer.' },
  { role: 'user', content: 'Suche aktuelle Azure CLI Dokumentation.' },
];
test('E: Endpunktauflösung für Responses und Azure Chat Completions', () => {
  assert.equal(resolveEndpoint('https://x.openai.azure.com/openai/v1', 'responses'), 'https://x.openai.azure.com/openai/v1/responses');
  assert.equal(resolveEndpoint('https://x.openai.azure.com/openai/deployments/terra/chat/completions?api-version=2024-10-21'), 'https://x.openai.azure.com/openai/deployments/terra/chat/completions?api-version=2024-10-21');
  assert.throws(() => resolveEndpoint('https://x.openai.azure.com/openai/deployments/terra/chat/completions?api-version=2024-10-21', 'responses'));
});

test('E: Azure Responses sendet web_search und meldet die Anzahl der Suchanfragen', async t => {
  let calls = 0;
  let usageReport;
  t.mock.method(globalThis, 'fetch', async (url, args) => {
    calls++;
    assert.equal(url, 'https://x.openai.azure.com/openai/v1/responses');
    assert.equal(args.headers['api-key'], 'test-key');
    assert.equal(args.headers.Authorization, undefined);
    const req = JSON.parse(args.body);
    assert.equal(req.model, 'terra-production');
    assert.equal(req.instructions, 'Du bist ein Terminalhelfer.');
    assert.equal(req.input[0].role, 'user');
    assert.deepEqual(req.tools, [{ type: 'web_search' }]);
    return {ok:true, text:async () => JSON.stringify({
      output: [
        {type: 'reasoning', summary: []},
        {type: 'web_search_call', action: {type: 'search', query: 'Azure cli'}},
        {type: 'message', role: 'assistant', content:[
          {type:'output_text', text:'Du kannst az account show ausfuehren.', annotations:[
            {type:'url_citation', title: 'Azure CLI', url:'https://learn.microsoft.com/en-us/cli/azure/'},
            {type:'url_citation', title: 'Azure CLI', url:'https://learn.microsoft.com/en-us/cli/azure/'}
          ]}
        ]}
      ], tool_usage: {web_search: {num_requests: 1}}
    })};
  });
  const result = await chatCompletion({endpoint:'https://x.openai.azure.com/openai/v1', apiKey:'test-key', model:'terra-production', messages, apiMode:'responses', webSearch:true, onWebSearchUsage: usage => usageReport=usage});
  assert.match(result, /Du kannst az/);
  assert.match(result, /Quellen:/);
  assert.equal((result.match(/https:\/\/learn\.microsoft\.com/g) || []).length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(usageReport, { used: true, requests: 1 });
});

test('E: Chat Completions verwendet das bestehende Format und lehnt Websuche ab', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url,args) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const req = JSON.parse(args.body);
    assert.ok(!('tools' in req));
    assert.equal(args.headers.Authorization, 'Bearer key');
    assert.equal(args.headers['api-key'], 'key');
    assert.equal(req.messages[0].role, 'system');
    return {ok: true, text:async () => JSON.stringify({choices:[{message:{content:'Alter Modus funktioniert.'}}]})};
  });
  assert.equal(await chatCompletion({endpoint:'https://api.openai.com/v1',apiKey:'key',model:'test',messages}), 'Alter Modus funktioniert.');
  await assert.rejects(() => chatCompletion({endpoint:'https://x.openai.azure.com/openai/v1',apiKey:'key',model:'test',messages,apiMode:'chat_completions',webSearch:true}), /erfordert/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('E: Responses erlaubt den Fallback-Text und meldet fehlenden Antworttext', () => {
  assert.throws(() => extractResponsesAnswer({output:[{type:'reasoning'}]}), /keinen Antworttext/);
  assert.equal(extractResponsesAnswer({output_text:'Fallback'}), 'Fallback');
});

test('E: nackte und Markdown-Quellen erscheinen jeweils nur einmal am Ende', () => {
  // Quellen nur einmal: Zitat-URLs aus dem Text, Liste bleibt vollständig.
  const inlineAnswer = extractResponsesAnswer({output:[{type:'message',content:[{
    type:'output_text',
    text:'Siehe https://learn.microsoft.com/x fuer Details.',
    annotations:[
      {type:'url_citation',title:'MS',url:'https://learn.microsoft.com/x'},
      {type:'url_citation',title:'Andere',url:'https://example.com/y'}
    ]
  }]}]});
  assert.ok(!inlineAnswer.includes('Siehe https://learn.microsoft.com/x'), 'URL blieb zusätzlich im Text');
  assert.match(inlineAnswer, /Siehe fuer Details\./, 'Text wurde nicht sauber gekürzt');
  assert.match(inlineAnswer, /Quellen:\n- MS: https:\/\/learn\.microsoft\.com\/x\n- Andere: https:\/\/example\.com\/y/);
  assert.equal((inlineAnswer.match(/https:\/\/learn\.microsoft\.com\/x/g) || []).length, 1, 'Quelle doppelt');
  const markdownCite = extractResponsesAnswer({output:[{type:'message',content:[{
    type:'output_text',
    text:'Siehe ([Microsoft](https://learn.microsoft.com/x)) fuer Details.',
    annotations:[{type:'url_citation',title:'MS',url:'https://learn.microsoft.com/x'}]
  }]}]});
  assert.equal((markdownCite.match(/learn\.microsoft\.com/g) || []).length, 1, 'Markdown-Zitat doppelt');
  assert.match(markdownCite, /^Siehe fuer Details\./);
});

const options = { endpoint: 'http://localhost:8088/v1', apiKey: 'test-key', model: 'test-modell', messages };
const url = 'https://example.test/quelle';
const citation = { type: 'url_citation', title: 'Dokumentation', url };
function annotated(text) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [citation, citation] }] }] };
}

test('E: modellgenerierter Quellenblock wird innerhalb der letzten sechs Zeilen abgeschnitten', () => {
  const answer = extractResponsesAnswer(annotated([
    `Siehe [Handbuch](${url}) und (${url}) für Details.`,
    '',
    '**Quellen:**',
    `- Wiederholung: ${url}`,
    '- Nicht aus Annotation: https://example.test/andere',
    '- Von',
    '- Modell',
    '- Erzeugt',
  ].join('\n')));
  assert.equal(answer, `Siehe und für Details.\n\nQuellen:\n- Dokumentation: ${url}`);

  const headingInText = ['Quellen: ein Absatzbegriff', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben'].join('\n');
  assert.equal(extractResponsesAnswer(annotated(headingInText)), `${headingInText}\n\nQuellen:\n- Dokumentation: ${url}`);
});

test('E: eine Antwort aus bloßen Zitaten enthält danach nur den kanonischen Quellenblock', () => {
  assert.equal(extractResponsesAnswer(annotated(`([Handbuch](${url}))`)), `Quellen:\n- Dokumentation: ${url}`);
});

test('E: Zitatziel wird nicht aus einem Terminal-Codeblock oder als Präfix einer anderen URL entfernt', () => {
  const body = [
    `Eine andere URL: ${url}.html`,
    '```az',
    `az rest --url ${url}`,
    '```',
  ].join('\n');
  assert.equal(extractResponsesAnswer(annotated(body)), `${body}\n\nQuellen:\n- Dokumentation: ${url}`);
});

test('E: Responses ohne Websuche sendet kein Werkzeug und meldet keine verwendete Suche', async t => {
  t.mock.method(globalThis, 'fetch', async (endpoint, request) => {
    assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    assert.equal(request.headers.Authorization, 'Bearer test-key');
    assert.equal(request.headers['api-key'], undefined);
    assert.ok(!('tools' in JSON.parse(request.body)));
    return { ok: true, text: async () => JSON.stringify({ output_text: 'Antwort' }) };
  });
  const usage = [];
  const answer = await chatCompletion({
    ...options,
    endpoint: 'https://api.openai.com/v1',
    apiMode: 'responses',
    onWebSearchUsage: value => usage.push(value),
  });
  assert.equal(answer, 'Antwort');
  assert.deepEqual(usage, [{ used: false }]);
});

test('E: Netzwerkfehler nennt Host samt Port und die verschachtelte Ursache', async t => {
  const inner = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const group = new AggregateError([inner], 'Verbindungen fehlgeschlagen');
  const failure = new TypeError('fetch failed', { cause: group });
  const endpoint = options.endpoint + '/chat/completions';
  const description = describeFetchFailure(failure, endpoint, 120_000, options.model);
  assert.match(description.message, /Verbindung abgelehnt: auf localhost:8088/);
  assert.match(description.message, /Ursache: fetch failed <- Verbindungen fehlgeschlagen <- connect ECONNREFUSED \[ECONNREFUSED\]/);
  assert.ok(description.message.includes(`Endpoint: ${endpoint}\nModell: test-modell`));
  t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  await assert.rejects(() => chatCompletion(options), { message: description.message });
});

test('E: Timeout und Abort beim Lesen des Antworttexts melden die Zeitüberschreitung', async t => {
  for (const name of ['TimeoutError', 'AbortError']) {
    const failure = new DOMException('Anfrage abgebrochen', name);
    const description = describeFetchFailure(failure, options.endpoint, 3000, options.model);
    assert.match(description.message, /Keine Antwort innerhalb von 3 s/);
    assert.match(description.message, /Ursache: Anfrage abgebrochen/);
  }
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    text: async () => { throw new DOMException('Antwort abgebrochen', 'AbortError'); },
  }));
  await assert.rejects(() => chatCompletion({ ...options, timeoutMs: 3000 }), {
    message: /Keine Antwort innerhalb von 3 s[\s\S]*localhost:8088[\s\S]*Ursache: Antwort abgebrochen/,
  });
  assert.match(describeFetchFailure('Lesefehler', options.endpoint, 3000, options.model).message, /Ursache: Lesefehler/);
});

test('E: ungültige URL liefert eine verständliche Konfigurationsmeldung ohne Fetch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('fetch darf nicht aufgerufen werden'));
  await assert.rejects(() => chatCompletion({ ...options, endpoint: 'http://localhost:falsch/v1' }), {
    message: /Ungültige Endpoint-URL[\s\S]*localhost:falsch[\s\S]*Modell: test-modell[\s\S]*ERR_INVALID_URL/,
  });
  assert.equal(fetch.mock.callCount(), 0);
});

test('E: HTTP-Fehler meldet Status, Einstellung und Antworttext', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'Schlüssel nicht akzeptiert',
  }));
  await assert.rejects(() => chatCompletion(options), {
    message: /HTTP 401 Unauthorized[\s\S]*linkTerminalBot.chatApiKey[\s\S]*Schlüssel nicht akzeptiert/,
  });
});
