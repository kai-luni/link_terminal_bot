import { TerminalCommandEntry } from './types';

/**
 * Ringpuffer der beobachteten Befehle einer VS-Code-Sitzung.
 * Das ist der Kontext, den ein Berater (später das Modell) zu sehen bekommt.
 */
export class SessionContext {
  private entries: TerminalCommandEntry[] = [];

  add(entry: TerminalCommandEntry, limit: number): void {
    this.entries.push(entry);
    while (this.entries.length > Math.max(1, limit)) {
      this.entries.shift();
    }
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
