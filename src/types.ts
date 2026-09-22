/**
 * Ein beobachteter Terminal-Befehl mit dem, was die Shell-Integration liefert:
 * Kommandozeile, Ausgabe (gekürzt) und Exit-Code.
 */
export interface TerminalCommandEntry {
  /** Laufende Nummer innerhalb der Extension-Sitzung. */
  id: number;
  /** Kommandozeile, wie sie im Terminal abgeschickt wurde. */
  command: string;
  /** Ausgabe des Befehls, auf `maxOutputChars` gekürzt (Anfang wird verworfen). */
  output: string;
  /** Exit-Code, `undefined` wenn das Terminal den Lauf nicht sauber beendet hat. */
  exitCode: number | undefined;
  /** Arbeitsverzeichnis zum Startzeitpunkt, falls die Shell-Integration es meldet. */
  cwd: string | undefined;
  /** Name des Terminals im Panel. */
  terminal: string;
  startedAt: Date;
  durationMs: number | undefined;
}
