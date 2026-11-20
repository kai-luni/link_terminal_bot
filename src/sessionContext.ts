import { TerminalCommandEntry } from './types';

/**
 * Puffer der beobachteten Befehle einer VS-Code-Sitzung.
 * Enthält alle Befehle der Sitzung; begrenzt wird erst beim Zusammenbau des Kontexts.
 */
export class SessionContext {
  private entries: TerminalCommandEntry[] = [];

  add(entry: TerminalCommandEntry): void {
    this.entries.push(entry);
  }

  get all(): readonly TerminalCommandEntry[] {
    return this.entries;
  }

  get last(): TerminalCommandEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  clear(): void {
    this.entries = [];
  }
}
