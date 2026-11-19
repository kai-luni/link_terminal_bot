import { TerminalCommandEntry } from './types';

export const DEFAULT_WATCHED_COMMANDS = ['az', 'azd'];
export const DEFAULT_MAX_OUTPUT_CHARS = 8000;

/** Erstes Wort des Befehls gegen die konfigurierte Liste prüfen. */
export function isWatched(command: string, watched: readonly string[]): boolean {
  const tokens = command.trim().split(/\s+/);
  // PowerShell-Aufrufoperator und sudo für den Vergleich überspringen.
  const first = tokens.find(token => token !== '&' && token !== 'sudo');
  return !!first && watched.includes(first);
}

/** Hinweistext, der an der Stelle der Kürzung steht und mit an das Modell geht. */
export function truncationMarker(omittedChars: number, totalChars: number): string {
  return `[... Ausgabe gekürzt: ${omittedChars} von ${totalChars} Zeichen in der Mitte weggelassen ...]`;
}

/** Hält beim Lesen nur den Anfang und das rollende Ende der Ausgabe im Speicher. */
export async function readTerminalOutput(
  read: () => AsyncIterable<string>,
  configuredMax = DEFAULT_MAX_OUTPUT_CHARS,
  onReadError: (error: unknown) => void = () => {},
): Promise<Pick<TerminalCommandEntry, 'output' | 'omittedChars'>> {
  const maxChars = Number.isFinite(configuredMax)
    ? Math.max(400, Math.floor(configuredMax))
    : DEFAULT_MAX_OUTPUT_CHARS;
  const headLimit = Math.max(400, Math.round(maxChars * 0.3));
  const tailLimit = maxChars - headLimit;
  let head = '';
  let tail = '';
  let totalChars = 0;
  let incomplete = '';

  try {
    for await (const chunk of read()) {
      totalChars += chunk.length;
      const take = Math.min(chunk.length, headLimit - head.length);
      head += chunk.slice(0, take);
      if (tailLimit > 0 && take < chunk.length) {
        tail = (tail + chunk.slice(take)).slice(-tailLimit);
      }
    }
  } catch (err) {
    // Terminal geschlossen oder Lauf abgebrochen: Ausgabe bis dahin behalten.
    incomplete = `[Ausgabe unvollständig: ${String(err)}]`;
    onReadError(err);
  }

  // Vor dem Trimmen rechnen, damit Zeilenumbrüche nicht als weggelassen gelten.
  const omittedChars = totalChars - head.length - tail.length;
  const retained = omittedChars > 0
    ? `${head.trimEnd()}\n${truncationMarker(omittedChars, totalChars)}\n${tail.trimStart()}`
    : head + tail;
  const output = [incomplete, retained.trim()].filter(Boolean).join('\n');
  return omittedChars > 0 ? { output, omittedChars } : { output };
}
