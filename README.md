# link_terminal_bot

## Schnellstart: bauen und testweise in VS Code installieren

Voraussetzungen: Node.js 20+ und VS Code **1.93 oder neuer**.
Nicht mit „Install from VSIX" installieren — die Extension ist `private` und unversioniert,
also läuft der Test über die **Extension Development Host** (auch auf deinem normalen VS Code,
deine installierten Extensions und Einstellungen bleiben unberührt).

```powershell
git clone https://github.com/kai-luni/link_terminal_bot.git
cd link_terminal_bot
npm install
npm run compile          # TypeScript -> out/
code .                   # dieses Verzeichnis in VS Code öffnen
```

In VS Code dann **`F5`** drücken → *Run and Debug*, Konfiguration
**„Extension starten (ohne Debugger)"** ist vorgewählt (kompiliert automatisch vorher). Es
öffnet sich ein zweites Fenster „Extension Development Host": dort im Terminal einmal `az
account show` oder `az group list` laufen lassen, dann rechts in der Seitenleiste
**Link Terminal Bot** öffnen (oder `Strg+Shift+P` → *Link Terminal Bot: Chat öffnen*) und
eine Frage stellen. Ohne `F5` klappt es auch direkt:

```powershell
code --extensionDevelopmentPath=. --new-window
```

Einmalig, sonst antwortet der Chat nicht — in den **User Settings** (`settings.json`) des
Fensters, in dem die Extension läuft:

```json
{
  "linkTerminalBot.chatEndpoint": "https://api.openai.com/v1",
  "linkTerminalBot.chatApiKey": "<dein key>",
  "linkTerminalBot.chatModel": "gpt-4o-mini"
}
```

Beenden: das Development-Host-Fenster schließen. Nach Code-Änderungen `npm run compile`
(oder `npm run watch`) und im Development-Host `Strg+Shift+P` → *Developer: Reload Window*.
`F5` bricht mit `Cannot find module 'out/extension.js'` ab, wenn vorher nie kompiliert wurde —
dann einmal `npm run compile`.

Verifiziert: `npm install` + `npm run compile` mit Node 24.14 / npm 11.9, `tsc` ohne Fehler.

---

VS-Code-Extension: liest Azure-CLI-Befehle im Terminal mit und beantwortet Fragen dazu
in einer Chat-Ansicht auf der rechten Seite.

Grundlage ist die **Terminal Shell Integration API** (stabil seit VS Code 1.93): VS Code
meldet jeder Extension, welcher Befehl im Terminal lief, was er ausgegeben hat und mit
welchem Exit-Code er endete. Genau das liest diese Extension mit — du musst also nichts
kopieren, wenn du den Chat fragst.

## Aufbau

- `src/terminalWatcher.ts` — hängt sich an die Shell-Integration-Events, filtert die
  konfigurierten Befehle (`az`, `azd`), sammelt Ausgabe (gekürzt auf `maxOutputChars`,
  Ende wird bevorzugt) und meldet den fertigen Befehl.
- `src/sessionContext.ts` — Ringpuffer der letzten Befehle (der Kontext für das Modell).
- `src/prompt.ts` — Systemprompt (kurz: ein Satz + ein Befehl) und der Kontextblock
  („Terminal-Verlauf"), der an die Frage gehängt wird.
- `src/llmClient.ts` — minimaler Client für OpenAI-kompatible Chat-Endpunkte (ohne
  `vscode`-Import, damit einzeln testbar).
- `src/chatView.ts` — die Chat-Ansicht in der Seitenleiste. Befehle in der Antwort
  (`az ...`) werden als Zeile mit **Einfügen**-Knopf gerendert.
- `src/extension.ts` — Verdrahtung, Output-Kanal, Befehle.

## Einrichten

In den **User Settings** (`settings.json`):

```json
{
  "linkTerminalBot.chatEndpoint": "https://api.openai.com/v1",
  "linkTerminalBot.chatApiKey": "<dein key>",
  "linkTerminalBot.chatModel": "gpt-4o-mini"
}
```

- `chatEndpoint` ist die Basis-URL; `/chat/completions` wird angehängt. Eine vollständige
  URL (z. B. Azure OpenAI mit `?api-version=...`) wird unverändert benutzt.
- Der Key wird als `Authorization: Bearer` **und** als `api-key`-Header geschickt, damit
  auch Azure-OpenAI-Endpunkte funktionieren.
- Der Key steht im Klartext in der `settings.json` — für den Dauerbetrieb wäre
  SecretStorage der bessere Ort.

## Starten

```bash
npm install
npm run compile
```

Dann `F5` („Extension starten"), im neuen Fenster rechts die Seitenleiste
**Link Terminal Bot** öffnen (oder `Strg+Shift+P` → *Link Terminal Bot: Chat öffnen*),
im Terminal arbeiten und im Chat fragen.

## Befehle

- `Link Terminal Bot: Chat öffnen`
- `Link Terminal Bot: Sitzungskontext anzeigen` (alle mitgelesenen Befehle im Output-Kanal)
- `Link Terminal Bot: Sitzungskontext leeren`

## Statusleiste

Unten rechts sitzt ein Icon **Terminal Bot**:

- **blau** — Beobachtung aktiv, aber keine `azure_knowledge.md` im Workspace,
- **grün** — aktiv und Azure-Wissen geladen (Tooltip zeigt Pfad und Zeichenzahl),
- **grau** mit `⊘` — Beobachtung aus (`linkTerminalBot.enabled = false`).

Klick öffnet den Chat. Die Farben sind über die Theme-Farben
`linkTerminalBot.statusBarActive` / `.statusBarKnowledge` / `.statusBarOff` einstellbar
(`workbench.colorCustomizations`). Das Icon reagiert sofort, wenn die Datei angelegt,
geändert oder gelöscht wird.

## Einstellungen

- `linkTerminalBot.enabled` — Beobachtung an/aus (Standard: an).
- `linkTerminalBot.watchedCommands` — erstes Wort des Befehls (Standard: `az`, `azd`).
- `linkTerminalBot.maxOutputChars` — wie viel Ausgabe pro Befehl behalten wird (4000).
- `linkTerminalBot.historySize` — wie viele Befehle im Kontext bleiben (20).
- `linkTerminalBot.chatContextCommands` — wie viele davon ans Modell gehen (5).
- `linkTerminalBot.chatEndpoint` / `chatApiKey` / `chatModel` — siehe oben.

## Bedienung

Der Bot antwortet knapp: ein Satz, dann genau ein Befehl. Jeder Codeblock in der Antwort
wird zu **einer** einfügbaren Zeile mit **Einfügen**-Knopf — auch ein mehrzeiliger Block
(PowerShell o. Ä.) wird als Ganzes eingefügt. Zusätzlich werden `az`/`azd`-Zeilen im
Fließtext klickbar. Eingefügt heißt: der Text landet am Prompt des aktiven Terminals,
**ausgeführt wird er nicht** (Enter drückst du). Der Kontext (die zuletzt mitgelesenen
Befehle) geht bei jeder Frage automatisch mit. Solange eine Antwort unterwegs ist, steht
**schreibt …** im Chat; ein eingefügter Befehl wird in seiner Zeile mit **✓ eingefügt**
markiert und lässt sich nicht versehentlich zweimal einfügen.

## Automatische Hinweise

Der Bot schaut von selbst mit: endet ein mitgelesener Befehl, prüft er, ob es etwas zu sagen
gibt — und schweigt, wenn nicht (dann steht nur eine Zeile im Output-Kanal). Reagiert wird
z. B. auf Fehler oder auf Befehle, nach denen der nächste Schritt fast immer folgt
(`az login` → Subscription setzen, `create` → Ergebnis prüfen). Automatische Hinweise sind
im Chat mit `automatisch · $ <Befehl> (exit N)` gekennzeichnet.

Steuerung:
- `linkTerminalBot.autoAdvise`: `off` | `errors` | `always` (Standard `always`).
- `linkTerminalBot.autoAdviseSeconds`: Mindestabstand zwischen zwei Hinweisen (Standard 8) —
  verhindert, dass eine schnelle Befehlsfolge viele Modellaufrufe auslöst. Wird ein Befehl aus
  dem Chat eingefügt, gilt der Abstand nicht: der nächste Befehl ist die Folge unseres
  Vorschlags und bekommt sofort eine Antwort. Läuft noch eine Anfrage, wird der Befehl nicht
  verworfen, sondern danach nachgezogen.
- Warum **kein** Hinweis kam, steht im Ausgabe-Kanal (Zeile pro Befehl: „kein Hinweis",
  „Mindestabstand noch nicht um", „zurückgestellt" oder die Fehlermeldung).

## Log-Datei

Alles landet zusätzlich in **`~/link-terminal-bot.log`** — gleiche Bauart wie blinks
`~/blink-llm.log`: pro Eintrag ein Block mit Zeitstempel, Typ und Payload (JSON). Typen:

- `COMMAND` — mitgelesener Befehl mit Ausgabe, Exit-Code, Dauer
- `ASK` / `ANSWER` — deine Frage inklusive des kompletten Prompts und die Antwort
- `AUTO_REQUEST` / `AUTO_ANSWER` / `AUTO_SKIP` / `AUTO_DEFER` / `AUTO_ERROR` — automatische
  Hinweise samt Begründung, wenn geschwiegen wurde (z. B. Mindestabstand, Modus `errors`)
- `SESSION` / `SESSION_END` — beim Start bzw. Ende: Extension-Version, VS-Code-Version,
  Plattform, Node, ob Shell-Integration schon gemeldet wurde, **alle wirksamen Einstellungen**
  (Endpoint, Modell, `autoAdvise`, `watchedCommands`, Limits) und ob ein API-Key gesetzt ist
  (der Key selbst nie)
- `CONFIG_CHANGE` — die Einstellungen wurden geändert, mit dem neuen Stand
- `VIEW_OPENED` / `VIEW_CLOSED` — die Chat-Ansicht wurde geöffnet/geschlossen
- `SHELL_INTEGRATION` — VS Code hat Shell-Integration für ein Terminal gemeldet
- `WATCH_SKIP` — der Befehl wurde **nicht** beobachtet, mit Grund (deaktiviert oder erstes
  Wort nicht in `watchedCommands`); pro erstem Wort nur einmal, damit das Log lesbar bleibt
- `WATCH_ERROR` — die Ausgabe eines Befehls konnte nicht vollständig gelesen werden
- `WEBVIEW_ERROR` — Fehler in der Chat-Ansicht (dort sieht der Extension-Host sonst nichts)
- `KNOWLEDGE_LOADED` / `KNOWLEDGE_MISSING` / `KNOWLEDGE_ERROR` — ob eine `azure_knowledge.md`
  gefunden wurde (mit Pfad und Länge), bzw. warum nicht
- `UNCAUGHT_EXCEPTION` / `UNHANDLED_REJECTION` — Abbrüche in der Extension, mit Stack
- `ERROR` — Modell-/HTTP-Fehler bei deinen Fragen
- `INFO` — dieselben Zeilen wie im Output-Kanal

Der API-Key wird nie geloggt. Ab 2 MB wird die Datei nach `~/link-terminal-bot.log.1`
weggedreht (eine Generation, ältere wird überschrieben).

## Azure-Wissen (`azure_knowledge.md`)

Liegt im Workspace-Root (oder in einem Unterordner der ersten Ebene) eine
`azure_knowledge.md`, wird ihr Inhalt automatisch an jede Frage **und** an jeden
automatischen Hinweis angehängt — damit kennt das Modell Tenant, Subscriptions,
Resource Groups und Namenskonventionen, statt sie zu erraten.

- Gesucht wird: `<workspace>/azure_knowledge.md`, dann `<workspace>/<unterordner>/azure_knowledge.md`
  (alphabetisch, versteckte Ordner ausgenommen). Erste Fundstelle gewinnt.
- Die Datei wird auf 5000 Zeichen gekappt (Ende abgeschnitten, mit Hinweis im Prompt).
- Ändert sie sich, greift die Änderung bei der nächsten Frage (Cache über mtime).
- Fehlt sie, passiert nichts — kein Fehler, nur eine `KNOWLEDGE_MISSING`-Zeile im Log.
- Beim Start steht im Log `KNOWLEDGE_LOADED` mit Pfad und Länge, im Ausgabe-Kanal die Pfadzeile.

Inhalt: nur Orientierungswissen (Subscription-Name/-ID, Resource Groups, Regionen,
Namenskonventionen, Tabus). **Keine Keys, Passwörter oder Verbindungsstrings.** Wenn das
Repo öffentlich ist, gehört die Datei nicht in die Git-History — lokal ignorieren reicht:

```
# .git/info/exclude (klon-lokal, landet in keinem Commit)
azure_knowledge.md
```

## Grenzen

- Ohne Shell-Integration (abgeschaltet oder nicht unterstützte Shell) kommen keine Events.
- Befehle in Pipes/Subshells (z. B. `echo x | az ...`) werden nicht erkannt; geprüft wird
  das erste Wort.
- Kein Streaming, keine Werkzeuge: eine Frage, eine Antwort. Der Chat sieht den
  Terminal-Puffer als Momentaufnahme beim Absenden, nicht live.
- Die Extension führt selbst keine Befehle aus — sie liest mit, schickt die gesammelte
  Ausgabe an den konfigurierten Endpunkt und schreibt auf Klick einen Befehl ins Terminal.
