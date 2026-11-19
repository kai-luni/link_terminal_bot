# Änderungsverzeichnis

## 0.2.0 — 19. November 2026

- Für Testbarkeit umgebaut: reine Logik liegt jetzt in eigenen Modulen (`terminalOutput`, `contextBudget`, `autoAdvisePolicy`, `statusText`, `chatSettings`, `chatSession`, `chatWebview`); `chatView` und `terminalWatcher` sind nur noch die VS-Code-Anbindung. Verhalten und Einstellungen unverändert.
- Tests auf `node:test` umgestellt, 43 Prüfungen über alle Funktionen: Kürzung mit Kopf/Ende und Marker, FIFO-Kontext samt Token-Budget, Auto-Hinweis-Modi und Mindestabstand, Aufgabe im Hinweis, Wiederholungsschutz, Sperre zwischen Frage und Hinweis, Verlauf/Epoche, Statuszeile, Quellen-Dedupe, Fehlermeldungen, kein API-Key in der Webview.
- `npm test` führt Kompilierung und alle Tests aus.

## 0.1.11 — 19. November 2026

- Die zugeklappte Statuszeile zeigt das Token-Budget mit: "Kontext · 2 Befehle · 1.2k / 500k Tokens" (belegt / Maximum aus `contextMaxTokens`).

## 0.1.10 — 19. November 2026

- Keine Endlosschleife mehr: schlägt der automatische Hinweis denselben Befehl vor, der in dieser Sitzung schon mit Fehler gescheitert ist, wird der Vorschlag ersetzt — statt des Codeblocks erscheint ein Satz mit dem Grund (exit-Code) und dem Hinweis auf den anderen Weg.
- Prompt-Regeln in beiden Prompts: keinen bereits gescheiterten Befehl wiederholen (auch nicht mit anderem Einleitungssatz); bei "invalid jmespath_type value" `--query` ohne führenden Punkt schreiben (`[].{Name:name}`).

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
