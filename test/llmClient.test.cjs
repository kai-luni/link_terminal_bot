const assert = require('node:assert/strict');
const { chatCompletion, resolveEndpoint, extractResponsesAnswer } = require('../out/llmClient.js');
const messages = [
  { role: 'system', content: 'Du bist ein Terminalhelfer.' },
  { role: 'user', content: 'Suche aktuelle Azure CLI Dokumentation.' },
];
(async () => {
  assert.equal(resolveEndpoint('https://x.openai.azure.com/openai/v1', 'responses'), 'https://x.openai.azure.com/openai/v1/responses');
  assert.equal(resolveEndpoint('https://x.openai.azure.com/openai/deployments/terra/chat/completions?api-version=2024-10-21'), 'https://x.openai.azure.com/openai/deployments/terra/chat/completions?api-version=2024-10-21');
  assert.throws(() => resolveEndpoint('https://x.openai.azure.com/openai/deployments/terra/chat/completions?api-version=2024-10-21', 'responses'));
  let calls = 0;
  let usageReport;
  global.fetch = async (url, args) => {
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
  };
  const result = await chatCompletion({endpoint:'https://x.openai.azure.com/openai/v1', apiKey:'test-key', model:'terra-production', messages, apiMode:'responses', webSearch:true, onWebSearchUsage: usage => usageReport=usage});
  assert.match(result, /Du kannst az/);
  assert.match(result, /Quellen:/);
  assert.equal((result.match(/https:\/\/learn\.microsoft\.com/g) || []).length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(usageReport, { used: true, requests: 1 });
  global.fetch = async (url,args) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const req = JSON.parse(args.body);
    assert.ok(!('tools' in req));
    assert.equal(args.headers.Authorization, 'Bearer key');
    assert.equal(args.headers['api-key'], 'key');
    assert.equal(req.messages[0].role, 'system');
    return {ok: true, text:async () => JSON.stringify({choices:[{message:{content:'Alter Modus funktioniert.'}}]})};
  };
  assert.equal(await chatCompletion({endpoint:'https://api.openai.com/v1',apiKey:'key',model:'test',messages}), 'Alter Modus funktioniert.');
  assert.throws(() => extractResponsesAnswer({output:[{type:'reasoning'}]}), /keinen Antworttext/);
  assert.equal(extractResponsesAnswer({output_text:'Fallback'}), 'Fallback');
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
  console.log('Quellen-Dedupe: OK');
  await assert.rejects(() => chatCompletion({endpoint:'https://x.openai.azure.com/openai/v1',apiKey:'key',model:'test',messages,apiMode:'chat_completions',webSearch:true}), /erfordert/);
  console.log('Alle Tests bestanden: Azure Responses + Suche + Quellen, alter Chatmodus, Fehlermeldungen.');
})().catch(err => {console.error(err); process.exit(1)});
