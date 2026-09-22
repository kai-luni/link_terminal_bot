import { TerminalCommandEntry } from './types';

/** Systemprompt für den Terminal-Assistenten: kurz, ein Befehl, klickbarer Codeblock. */
export const SYSTEM_PROMPT = [
  'Du bist ein Assistent für die Azure CLI in einem VS-Code-Terminal.',
  'Der Nutzer beschreibt sein Problem; du bekommst zusätzlich den Verlauf der zuletzt mitgelesenen Terminal-Befehle mit Ausgabe und Exit-Code.',
  'Antworte auf Deutsch und so kurz wie möglich: ein Satz, danach genau ein Befehl in einem Codeblock mit der Sprache "az".',
  'Der Nutzer klickt den Befehl im Codeblock an, um ihn ins Terminal einzufügen — deshalb: pro Antwort nur ein Befehl, keine Parameter-Erklärungen, keine Alternativen, keine Aufzählungen.',
  'Nur wenn der Nutzer ausdrücklich mehr verlangt (Überblick, mehrere Schritte, Erklärung), darf die Antwort länger sein.',
  'Formbeispiel: "Zeigt alle Gruppen der aktiven Subscription:" gefolgt von einem az-Codeblock mit `az group list -o table`.',
  'Stütze dich auf den mitgelieferten Verlauf. Fehlt dir Information, nenne den einen Befehl, der sie liefert, statt zu raten.',
  'Erfinde keine Ressourcennamen, IDs oder Subscription-Werte.',
].join('\n');

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
