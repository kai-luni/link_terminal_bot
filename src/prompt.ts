import { TerminalCommandEntry } from './types';

/** Systemprompt für den Terminal-Assistenten: kurz, ein Befehl, klickbarer Codeblock. */
export const SYSTEM_PROMPT = [
  'Du bist ein Assistent für die Azure CLI in einem VS-Code-Terminal.',
  'Der Nutzer beschreibt sein Problem; du bekommst zusätzlich den Verlauf der zuletzt mitgelesenen Terminal-Befehle mit Ausgabe und Exit-Code.',
  'Antworte auf Deutsch und so kurz wie möglich: ein Satz, danach genau ein Befehl in einem Codeblock mit der Sprache "az".',
  'Der Nutzer klickt den Befehl im Codeblock an, um ihn ins Terminal einzufügen — deshalb: pro Antwort nur ein Befehl, keine Parameter-Erklärungen, keine Alternativen, keine Aufzählungen.',
  'Nutze echte az-Befehle. Keine PowerShell-Konstrukte (kein `$var = ...`, kein ConvertTo-Json, keine handgebauten JSON-Bodies) — wenn ein Aufruf zu lang wird, nimm den einfacheren az-Befehl oder eine `--query`-Auswahl.',
  'Alles, was der Nutzer ausführen soll, gehört in den Codeblock (auch ein mehrzeiliger Befehl).',
  'Nur wenn der Nutzer ausdrücklich mehr verlangt (Überblick, mehrere Schritte, Erklärung), darf die Antwort länger sein.',
  'Formbeispiel: "Zeigt alle Gruppen der aktiven Subscription:" gefolgt von einem az-Codeblock mit `az group list -o table`.',
  'Stütze dich auf den mitgelieferten Verlauf. Fehlt dir Information, nenne den einen Befehl, der sie liefert, statt zu raten.',
  'Erfinde keine Ressourcennamen, IDs oder Subscription-Werte.',
].join('\n');

/** Das Modell antwortet genau damit, wenn es nichts zu sagen gibt. */
export const SILENT_TOKEN = 'NICHTS';

/** Systemprompt für den automatischen Hinweis (ohne Frage des Nutzers). */
export const AUTO_SYSTEM_PROMPT = [
  'Du beobachtest mit, was im Azure-CLI-Terminal des Nutzers passiert.',
  'Du bekommst den gerade beendeten Befehl mit Ausgabe und Exit-Code plus etwas Verlauf.',
  'Wenn ein Fehler zu beheben ist oder ein sinnvoller nächster Schritt auf der Hand liegt: antworte mit EINEM kurzen Satz auf Deutsch und genau einem Befehl in einem Codeblock mit der Sprache "az".',
  'Melde dich auch nach erfolgreichen Befehlen, wenn der nächste Schritt fast immer folgt — z. B. nach `az login` oder `az account set` (Subscription prüfen/setzen), nach einem `create`/`update`/`delete` (Ergebnis verifizieren) oder wenn die Ausgabe einen Namen/eine ID liefert, die der nächste Befehl braucht.',
  `Wenn es nichts zu sagen gibt (Befehl war erfolgreich und der nächste Schritt ist offensichtlich oder unbekannt, Ausgabe ohne Problem), antworte exakt mit ${SILENT_TOKEN} und sonst nichts.`,
  'Lieber schweigen als raten: keine Vermutungen über fehlende Werte, keine Wiederholung des gerade gelaufenen Befehls.',
  'Keine Begrüßungen, keine Zusammenfassung der Ausgabe, keine Parameter-Erklärungen.',
].join('\n');

/** True, wenn die Antwort "nichts zu sagen" bedeutet. */
export function isSilent(answer: string): boolean {
  const normalized = answer.trim().replace(/[.!?:*\s]+$/g, '').toUpperCase();
  return normalized.length === 0 || normalized === SILENT_TOKEN;
}

/** Kontextblock für den automatischen Hinweis: der letzte Befehl plus Verlauf. */
export function renderAutoContext(
  entry: TerminalCommandEntry,
  history: readonly TerminalCommandEntry[],
  limit: number,
): string {
  const head = `Gerade beendet:\n$ ${entry.command}   -> exit ${entry.exitCode ?? '?'}`;
  const output = entry.output ? `\n${entry.output}` : '\n(keine Ausgabe)';
  return `${head}${output}\n\n${renderContext(history, limit)}`;
}

/** Baut den Kontextblock, den das Modell als Teil der Frage bekommt. */
export function renderContext(entries: readonly TerminalCommandEntry[], limit: number): string {
  const picked = entries.slice(-Math.max(1, limit));
  if (picked.length === 0) {
    return '### Terminal-Verlauf\n(noch keine Befehle mitgelesen)';
  }
  const blocks = picked.map((entry) => {
    const head = `$ ${entry.command}   -> exit ${entry.exitCode ?? '?'}`;
    return entry.output ? `${head}\n${entry.output}` : head;
  });
  return `### Terminal-Verlauf (letzte ${picked.length}, neueste zuletzt)\n${blocks.join('\n\n')}`;
}
