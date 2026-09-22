import { appendFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Debug-Log als Datei im Home-Verzeichnis — gleiche Bauart wie bei blink
 * (`~/blink-llm.log`): Block je Eintrag, Fehler werden geschluckt.
 */
export const DEFAULT_LOG_PATH = join(homedir(), 'link-terminal-bot.log');

/** Ab dieser Größe wird die Datei nach `<pfad>.1` weggedreht (nur eine Generation). */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Baut den Log-Eintrag im Blockformat. */
export function formatEntry(type: string, data: unknown, at: Date = new Date()): string {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return ['', '='.repeat(100), `${at.toISOString()} ${type}`, '='.repeat(100), serialized, ''].join('\n');
}

/** Hängt einen Eintrag an und dreht die Datei vorher weg, wenn sie zu groß ist. */
export async function writeLog(
  type: string,
  data: unknown,
  path: string = DEFAULT_LOG_PATH,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<void> {
  try {
    const info = await stat(path).catch(() => undefined);
    if (info && maxBytes > 0 && info.size > maxBytes) {
      await rename(path, `${path}.1`).catch(() => undefined);
    }
    await appendFile(path, formatEntry(type, data), 'utf8');
  } catch {
    // Logging darf den Ablauf niemals unterbrechen.
  }
}
