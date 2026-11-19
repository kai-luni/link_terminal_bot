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
  'Ist eine Ausgabe als gekürzt markiert ("Ausgabe gekürzt ... in der Mitte weggelassen"), behaupte nie, sie sei leer oder ein Eintrag fehle — nenne stattdessen den Befehl, der genau diese Information liefert (`--query`, `-o tsv`).',
  'Sind mehrere Schritte nötig, nenne den einen Befehl, der die Aufgabe am direktesten löst, statt Zwischenschritte zu staffeln.',
  'Reichen die vorhandenen Daten, um die Aufgabe zu beantworten, liefere direkt den Zielbefehl statt eines Vorbereitungsschritts.',
  'Erfinde keine Ressourcennamen, IDs oder Subscription-Werte.',
].join('\n');

/** Das Modell antwortet genau damit, wenn es nichts zu sagen gibt. */
export const SILENT_TOKEN = 'NICHTS';

/** Systemprompt für den automatischen Hinweis (ohne Frage des Nutzers). */
export const AUTO_SYSTEM_PROMPT = [
  'Du beobachtest mit, was im Azure-CLI-Terminal des Nutzers passiert.',
  'Du bekommst den gerade beendeten Befehl mit Ausgabe und Exit-Code plus etwas Verlauf.',
  'Antworte mit EINEM kurzen Satz auf Deutsch und genau einem Befehl in einem Codeblock mit der Sprache "az", sobald einer der folgenden Fälle zutrifft:',
  '- Fehler oder Exit-Code ungleich 0 (Ursache beheben oder fehlende Info abfragen).',
  '- Nach `create`, `update` oder `delete` (Ergebnis verifizieren).',
  '- Die Ausgabe enthält einen Namen, eine ID, eine Subscription oder einen Endpunkt, den der nächste Befehl braucht.',
  '- Nach `az login` oder `az account set` (aktive Subscription prüfen oder setzen).',
  '- Leere Ausgabe oder Verdacht auf falsche Subscription bzw. falsche Konfiguration.',
  '- Ein anderer sinnvoller nächster Schritt ist erkennbar.',
  'Im Zweifel gib lieber einen kurzen hilfreichen Hinweis statt zu schweigen.',
  'Der Hinweis muss aus dem gerade gelaufenen Befehl folgen — nach einem reinen Versions- oder Info-Befehl ohne Problem ist Schweigen richtig.',
  'Ist die Ausgabe als gekürzt markiert ("Ausgabe gekürzt ... in der Mitte weggelassen"), gilt sie nicht als leer: schließe nicht auf fehlende Einträge, sondern nenne den Filterbefehl (`--query`, `-o tsv`), der die fehlende Information gezielt liefert.',
  `Antworte exakt mit ${SILENT_TOKEN} (und sonst nichts) NUR dann, wenn der Befehl erfolgreich war UND wirklich kein sinnvoller nächster Schritt erkennbar ist.`,
  'Erfinde keine Ressourcennamen, IDs oder Subscription-Werte und wiederhole nicht einfach den gerade gelaufenen Befehl.',
  'Keine Begrüßungen, keine Zusammenfassung der Ausgabe, keine Parameter-Erklärungen.',
  'Ist eine offene Aufgabe des Nutzers mitgeschickt, arbeite auf genau diese Aufgabe zu; wiederhole keinen Zwischenschritt, den der Verlauf schon beantwortet hat.',
  'Pro Hinweis genau ein Schritt; wenn mehrere Schritte nötig wären, nenne den einen Befehl, der am meisten Information auf einmal liefert, statt eine Kette anzulegen.',
  'Ist die Aufgabe mit den vorhandenen Daten beantwortet, liefere statt eines weiteren az-Befehls das Ergebnis in ein bis drei Sätzen ohne Codeblock.',
  'Fachhinweis Tokenverbrauch: verbrauchte Tokens je Modell/Deployment liefert `az monitor metrics list --resource <account-id> --metric ProcessedPromptTokens,GeneratedTokens --interval PT1H --aggregation Total` (alternativ Cost Management); nicht subscription- und ressourcenweise durchklicken.',
  'Reichen die vorhandenen Daten, um die Aufgabe zu beantworten, liefere direkt den Zielbefehl statt eines Vorbereitungsschritts.',
  'Vorbereitungsbefehle sind nur erlaubt, wenn der Zielbefehl ohne sie nicht ausführbar ist.',
].join('\n');

/** True, wenn die Antwort "nichts zu sagen" bedeutet. */
export function isSilent(answer: string): boolean {
  const normalized = answer.trim().replace(/[.!?:*\s]+$/g, '').toUpperCase();
  return normalized.length === 0 || normalized === SILENT_TOKEN;
}

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

function formatEntry(entry: TerminalCommandEntry): string {
  const head = `$ ${entry.command}   -> exit ${entry.exitCode ?? '?'}`;
  return entry.output ? `${head}\n${entry.output}` : head;
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

/** Kontextblock für den automatischen Hinweis: der letzte Befehl plus Verlauf. */
export function renderAutoContext(
  entry: TerminalCommandEntry,
  history: readonly TerminalCommandEntry[],
  limit: number,
  maxTokens = Infinity,
): string {
  const head = `Gerade beendet:\n$ ${entry.command}   -> exit ${entry.exitCode ?? '?'}`;
  const output = entry.output ? `\n${entry.output}` : '\n(keine Ausgabe)';
  return `${head}${output}\n\n${renderContext(history, limit, maxTokens)}`;
}

/** Baut den Kontextblock, den das Modell als Teil der Frage bekommt. */
export function renderContext(
  entries: readonly TerminalCommandEntry[],
  limit: number,
  maxTokens = Infinity,
): string {
  return summarizeContext(entries, limit, maxTokens).text;
}
