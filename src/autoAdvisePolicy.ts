import { ChatMessage } from './llmClient';
import { AUTO_SYSTEM_PROMPT, firstAzCommand, renderAutoContext, sameCommand } from './prompt';
import { TerminalCommandEntry } from './types';

export type AutoAdviseMode = 'off' | 'errors' | 'always';

/** Ein unbekannter Exit-Code ist in der Shell-Integration kein erfolgreicher Abschluss. */
export function shouldAutoAdvise(mode: AutoAdviseMode, exitCode: number | undefined): boolean {
  return mode === 'always' || (mode === 'errors' && exitCode !== 0);
}

/**
 * Gibt die letzte Nutzerfrage aus dem Chat-Verlauf ohne angehängten Terminal-Kontext
 * und begrenzt sie hart auf 600 Zeichen.
 */
export function extractOpenUserTask(history: readonly ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') {
      continue;
    }
    let text = history[i].content;
    for (const marker of ['\n\n### Terminal-Verlauf', '\n\nGerade beendet:']) {
      const idx = text.indexOf(marker);
      if (idx !== -1) {
        text = text.slice(0, idx);
      }
    }
    text = text.trim().slice(0, 600);
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

export function buildAutoMessages(
  entry: TerminalCommandEntry,
  terminalHistory: readonly TerminalCommandEntry[],
  chatHistory: readonly ChatMessage[],
  limit: number,
  maxTokens: number,
  knowledge?: string,
): ChatMessage[] {
  const openTask = extractOpenUserTask(chatHistory);
  return [
    { role: 'system', content: AUTO_SYSTEM_PROMPT },
    ...(openTask ? [{ role: 'user' as const, content: `Offene Aufgabe des Nutzers:\n${openTask}` }] : []),
    {
      role: 'user',
      content: renderAutoContext(entry, terminalHistory, limit, maxTokens) + (knowledge ? `\n\n${knowledge}` : ''),
    },
  ];
}

/** Unterdrückt Befehle, die in dieser Sitzung schon mit Fehler gescheitert sind. */
export function repeatedFailure(
  answer: string,
  history: readonly TerminalCommandEntry[],
): { entry: TerminalCommandEntry; text: string } | undefined {
  const command = firstAzCommand(answer);
  if (!command) {
    return undefined;
  }
  const entry = history.find(candidate => (candidate.exitCode ?? 0) !== 0 && sameCommand(candidate.command, command));
  if (!entry) {
    return undefined;
  }
  const text =
    `Der Befehl ist identisch zum vorigen Versuch (exit ${entry.exitCode ?? '?'}) und würde wieder scheitern. ` +
    'Ich schlage ihn nicht erneut vor — nötig ist ein anderer Weg (bei `--query` ohne führenden Punkt, z. B. `[].{Name:name}`).';
  return { entry, text };
}
