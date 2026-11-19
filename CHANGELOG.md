# Änderungsverzeichnis

## 0.1.5 — 19. November 2026

- Behoben: Jede Ausgabe mit Zeilenumbruch wurde fälschlich als gekürzt markiert (Kürzung wird jetzt an den ungetrimmten Längen gemessen).
- Behoben: Ungültiger Wert bei `maxOutputChars` (NaN) ließ das Ausgabefenster unbegrenzt wachsen.
- Bei fehlender Kürzung werden Kopf und Ende ohne eingefügten Zeilenumbruch zusammengesetzt.

## 0.1.4 — 19. November 2026

- Neuer API-Modus `responses` mit Azure OpenAI v1 Responses API (`/openai/v1/responses`).
- `tools: [{"type":"web_search"}]` lässt GPT-6.1 Terra bei manuellen Chatfragen bei Bedarf suchen.
- Websuche für automatisch erzeugte Terminalhinweise standardmäßig abgeschaltet; getrennt zuschaltbar.
- Quellen aus `url_citation` werden lesbar und anklickbar angezeigt.
- Suchnutzung wird anhand von `web_search_call` erkannt; die von Azure gemeldete Anzahl `tool_usage.web_search.num_requests` wird im Chat angezeigt.
- Bisheriger Chat-Completions-Modus bleibt als Voreinstellung erhalten.
- Webview erhält keine API-Schlüssel mehr mit der Konfigurationsnachricht.
- Tests für Requests, Quellen, API-Modi und Fehlermeldungen ergänzt (`npm test`).

Hinweis: Die API-Anbindung wurde mit simulierten Azure-Antworten getestet. Für eine echte Internetsuche ist ein Azure-Endpunkt mit aktivierter Funktion sowie einem passenden Deployment und gültigem Schlüssel erforderlich.
