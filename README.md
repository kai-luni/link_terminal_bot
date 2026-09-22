# link_terminal_bot

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
Befehle) geht bei jeder Frage automatisch mit.

## Automatische Hinweise

Der Bot schaut von selbst mit: endet ein mitgelesener Befehl, prüft er, ob es etwas zu sagen
gibt — und schweigt, wenn nicht (dann steht nur eine Zeile im Output-Kanal). Reagiert wird
z. B. auf Fehler oder auf Befehle, nach denen der nächste Schritt fast immer folgt
(`az login` → Subscription setzen, `create` → Ergebnis prüfen). Automatische Hinweise sind
im Chat mit `automatisch · $ <Befehl> (exit N)` gekennzeichnet.

Steuerung:
- `linkTerminalBot.autoAdvise`: `off` | `errors` | `always` (Standard `always`).
- `linkTerminalBot.autoAdviseSeconds`: Mindestabstand zwischen zwei Hinweisen (Standard 15) —
  verhindert, dass eine schnelle Befehlsfolge viele Modellaufrufe auslöst.

## Grenzen

- Ohne Shell-Integration (abgeschaltet oder nicht unterstützte Shell) kommen keine Events.
- Befehle in Pipes/Subshells (z. B. `echo x | az ...`) werden nicht erkannt; geprüft wird
  das erste Wort.
- Kein Streaming, keine Werkzeuge: eine Frage, eine Antwort. Der Chat sieht den
  Terminal-Puffer als Momentaufnahme beim Absenden, nicht live.
- Die Extension führt selbst keine Befehle aus — sie liest mit, schickt die gesammelte
  Ausgabe an den konfigurierten Endpunkt und schreibt auf Klick einen Befehl ins Terminal.
