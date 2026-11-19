# Änderungsverzeichnis

## 0.1.9 — 19. November 2026

- Automatischer Hinweis kennt die offene Nutzerfrage: sie wird aus dem Chat-Verlauf mitgeschickt (ohne Terminal-Kontext, max. 600 Zeichen). Damit läuft die Antwort auf die Aufgabe zu statt blind Zwischenschritte vorzuschlagen.
- Prompt-Regeln gegen Befehlsketten: ein Schritt pro Hinweis, keine Wiederholung bereits beantworteter Schritte, Ergebnis statt weiterem Befehl, wenn die Daten reichen; Vorbereitungsbefehle nur wenn nötig.
- Fachhinweis Tokenverbrauch: `az monitor metrics list --metric ProcessedPromptTokens,GeneratedTokens` je Konto/Deployment statt Durchklicken aller Subscriptions.
- README ergänzt.

## 0.1.8 — 19. November 2026

- Statusleiste im Chat ist zugeklappt einzeilig ("Kontext · N Befehle · X Tokens"); Modell, Endpoint, Budget und belegte Tokens erscheinen erst beim Aufklappen — der Zustand bleibt erhalten.
- Neue Einstellung `linkTerminalBot.contextMaxTokens` (Standard 1500): Terminalkontext wird FIFO aufgefüllt, älteste Befehle fallen zuerst weg, der neueste bleibt immer. Schätzung ca. 4 Zeichen pro Token.
- README um `contextMaxTokens` und die aufklappbare Statusleiste ergänzt.

## 0.1.7 — 19. November 2026

- Keine parallelen Gesprächsstränge mehr: Frage und automatischer Hinweis teilen sich eine Sperre. Läuft eine Frage, wird der Terminalhinweis zurückgestellt; läuft ein Hinweis und der Nutzer fragt, wird die alte Hinweisantwort verworfen statt angezeigt.
- Der Chat-Verlauf wird beim Abschluss einer Frage an den aktuellen Stand angehängt (kein Überschreiben mehr) und bleibt nach "Verlauf löschen" konsistent.
- Schließen der Chat-Ansicht bricht ausstehende Hinweis-Timer ab (keine Anfrage mehr ohne sichtbares Panel).

## 0.1.6 — 19. November 2026

- Quellen werden nur noch einmal angezeigt: Zitat-Links und eigene "Quelle(n):"-Zeilen des Modells fliegen aus dem Antworttext, die Quellenliste am Ende bleibt (klickbar).

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
