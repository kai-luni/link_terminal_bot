# link_terminal_bot

VS-Code-Extension (Kern): beobachtet Azure-CLI-Befehle im Terminal und gibt Hinweise
zu Befehl, Ausgabe und Exit-Code.

Grundlage ist die **Terminal Shell Integration API** (stabil seit VS Code 1.93): VS Code
meldet jeder Extension, welcher Befehl im Terminal lief, was er ausgegeben hat und mit
welchem Exit-Code er endete. Genau das liest diese Extension mit.

## Aufbau

- `src/terminalWatcher.ts` — hängt sich an die Shell-Integration-Events, filtert die
  konfigurierten Befehle (`az`, `azd`), sammelt Ausgabe (gekürzt auf `maxOutputChars`,
  Ende wird bevorzugt) und meldet den fertigen Befehl.
- `src/sessionContext.ts` — Ringpuffer der letzten Befehle (der Kontext für den Berater).
- `src/advisor.ts` — `Advisor`-Schnittstelle plus regelbasierter Berater, der die
  häufigen az-Fehlerbilder erkennt (abgelaufener Login, RBAC, unbekannte Resource Group,
  falsche Subscription, nicht registrierter Provider, Syntaxfehler).
- `src/extension.ts` — Verdrahtung, Output-Kanal, Befehle.

Der Berater ist die Stelle, an der später das Modell andockt: ein LLM-Berater
implementiert einfach `Advisor.advise(entry, history)` und bekommt denselben Kontext.

## Starten

```bash
npm install
npm run compile
```

Dann in VS Code `F5` („Extension starten") — es öffnet sich ein zweites Fenster mit der
Extension. Dort im Terminal z. B. `az login` oder `az group list` laufen lassen und den
Kanal **Ausgabe → Link Terminal Bot** beobachten.

## Befehle (Befehlspalette)

- `Link Terminal Bot: Sitzungskontext anzeigen` — alle beobachteten Befehle mit Ausgabe.
- `Link Terminal Bot: Hinweis zum letzten Befehl` — Hinweis erneut berechnen.
- `Link Terminal Bot: Sitzungskontext leeren`.

## Einstellungen

- `linkTerminalBot.enabled` — Beobachtung an/aus (Standard: an).
- `linkTerminalBot.watchedCommands` — erstes Wort des Befehls (Standard: `az`, `azd`).
- `linkTerminalBot.maxOutputChars` — wie viel Ausgabe pro Befehl behalten wird (4000).
- `linkTerminalBot.historySize` — wie viele Befehle im Kontext bleiben (20).

## Grenzen des Kerns

- Ohne Shell-Integration (abgeschaltet oder nicht unterstützte Shell) kommen keine Events —
  die Extension tut dann nichts.
- Befehle, die in Pipes/Subshells stecken (z. B. `echo x | az ...`), werden nicht erkannt;
  geprüft wird das erste Wort.
- Noch kein Modellaufruf: die Hinweise kommen aus festen Regeln.
- Keine Ausführung von Befehlen durch die Extension — sie liest nur mit.
