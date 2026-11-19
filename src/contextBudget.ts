import { TerminalCommandEntry } from './types';

export interface ContextSummary {
  text: string;
  /** Anzahl der tatsächlich in den Kontext übernommenen Befehle. */
  includedCount: number;
  /** Gesamtzahl der Befehle im übergebenen Verlauf. */
  totalCount: number;
  /** Geschätzte Tokens des gesamten Kontextblocks (0 bei leerem Verlauf). */
  tokens: number;
}

/** Schätzt die Tokenzahl anhand der Zeichenlänge (ca. 4 Zeichen pro Token, aufgerundet). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatTerminalOutput(entry: TerminalCommandEntry): string {
  return entry.output || ((entry.omittedChars ?? 0) > 0 ? '(Ausgabe gekürzt)' : '');
}

function formatEntry(entry: TerminalCommandEntry): string {
  const head = `$ ${entry.command}   -> exit ${entry.exitCode ?? '?'}`;
  const output = formatTerminalOutput(entry);
  return output ? `${head}\n${output}` : head;
}

function renderContextBlock(blocks: readonly string[]): string {
  return `### Terminal-Verlauf (letzte ${blocks.length}, neueste zuletzt)\n${blocks.join('\n\n')}`;
}

/**
 * Stellt den Kontextblock FIFO zusammen (neueste Befehle zuerst behalten,
 * älteste zuerst weglassen), bis `limit` oder `maxTokens` erreicht ist.
 */
export function summarizeContext(
  entries: readonly TerminalCommandEntry[],
  limit: number,
  maxTokens = Infinity,
): ContextSummary {
  const totalCount = entries.length;
  const candidates = entries.slice(-Math.max(1, limit));
  if (candidates.length === 0) {
    return {
      text: '### Terminal-Verlauf\n(noch keine Befehle mitgelesen)',
      includedCount: 0,
      totalCount,
      tokens: 0,
    };
  }

  const budget = Number.isNaN(maxTokens) ? 1500 : Math.max(0, maxTokens);
  let pickedBlocks: string[] = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const nextBlocks = [formatEntry(candidates[i]), ...pickedBlocks];
    const candidateText = renderContextBlock(nextBlocks);
    // Den neuesten Befehl immer mitnehmen (sonst wäre der Kontext leer).
    if (pickedBlocks.length > 0 && estimateTokens(candidateText) > budget) {
      break;
    }
    pickedBlocks = nextBlocks;
  }

  const text = renderContextBlock(pickedBlocks);
  return {
    text,
    includedCount: pickedBlocks.length,
    totalCount,
    tokens: estimateTokens(text),
  };
}

/** Baut den Kontextblock, den das Modell als Teil der Frage bekommt. */
export function renderContext(
  entries: readonly TerminalCommandEntry[],
  limit: number,
  maxTokens = Infinity,
): string {
  return summarizeContext(entries, limit, maxTokens).text;
}
