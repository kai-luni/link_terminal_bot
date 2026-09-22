import { TerminalCommandEntry } from './types';

/** Systemprompt für den Terminal-Assistenten. */
export const SYSTEM_PROMPT = [
  'Du bist ein Assistent für die Azure CLI in einem VS-Code-Terminal.',
  'Der Nutzer beschreibt sein Problem; du bekommst zusätzlich den Verlauf der zuletzt mitgelesenen Terminal-Befehle mit Ausgabe und Exit-Code.',
  'Antworte kurz und auf Deutsch. Nenne konkrete az-Befehle, wenn sie helfen.',
  'Stütze dich auf den mitgelieferten Verlauf. Wenn dort etwas fehlt, sage welchen Befehl der Nutzer ausführen soll, statt zu raten.',
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
