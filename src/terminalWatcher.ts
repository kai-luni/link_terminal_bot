import * as vscode from 'vscode';
import { TerminalCommandEntry } from './types';

interface PendingExecution {
  entry: TerminalCommandEntry;
  chunks: string[];
  keptChars: number;
  maxOutputChars: number;
  readDone: Promise<void>;
}

/**
 * Beobachtet das VS-Code-Terminal über die Shell-Integration-API
 * (stabil seit VS Code 1.93) und meldet jeden beobachteten Befehl,
 * sobald er beendet ist — mit Ausgabe und Exit-Code.
 *
 * Ohne Shell-Integration (deaktiviert oder nicht unterstützte Shell) kommen
 * keine Events an; dann tut die Extension nichts und sagt das über `isActive`.
 */
export class TerminalWatcher implements vscode.Disposable {
  private readonly _onCommand = new vscode.EventEmitter<TerminalCommandEntry>();
  /** Feuert nach Befehlsende, wenn Kommandozeile, Ausgabe und Exit-Code vorliegen. */
  readonly onCommand: vscode.Event<TerminalCommandEntry> = this._onCommand.event;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly pending = new Map<vscode.TerminalShellExecution, PendingExecution>();
  private nextId = 1;
  private seenShellIntegration = false;

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration(() => {
        this.seenShellIntegration = true;
      }),
      vscode.window.onDidStartTerminalShellExecution((e) => this.handleStart(e)),
      vscode.window.onDidEndTerminalShellExecution((e) => void this.handleEnd(e)),
    );
  }

  /** True, sobald VS Code für mindestens ein Terminal Shell-Integration gemeldet hat. */
  get isActive(): boolean {
    return this.seenShellIntegration;
  }

  private settings(): { enabled: boolean; watched: string[]; maxOutputChars: number } {
    const cfg = vscode.workspace.getConfiguration('linkTerminalBot');
    return {
      enabled: cfg.get<boolean>('enabled', true),
      watched: cfg.get<string[]>('watchedCommands', ['az', 'azd']),
      maxOutputChars: cfg.get<number>('maxOutputChars', 4000),
    };
  }

  private handleStart(e: vscode.TerminalShellExecutionStartEvent): void {
    const { enabled, watched, maxOutputChars } = this.settings();
    if (!enabled) {
      return;
    }
    const command = e.execution.commandLine.value.trim();
    if (!isWatched(command, watched)) {
      return;
    }

    const entry: TerminalCommandEntry = {
      id: this.nextId++,
      command,
      output: '',
      exitCode: undefined,
      cwd: e.execution.cwd?.fsPath,
      terminal: e.terminal.name,
      startedAt: new Date(),
      durationMs: undefined,
    };

    const pending: PendingExecution = {
      entry,
      chunks: [],
      keptChars: 0,
      maxOutputChars: Math.max(200, maxOutputChars),
      readDone: Promise.resolve(),
    };
    this.pending.set(e.execution, pending);
    pending.readDone = this.readOutput(e.execution, pending);
  }

  /** Liest den Ausgabe-Stream mit und hält nur die letzten `maxOutputChars` Zeichen. */
  private async readOutput(
    execution: vscode.TerminalShellExecution,
    pending: PendingExecution,
  ): Promise<void> {
    try {
      for await (const chunk of execution.read()) {
        pending.chunks.push(chunk);
        pending.keptChars += chunk.length;
        while (pending.keptChars > pending.maxOutputChars && pending.chunks.length > 1) {
          pending.keptChars -= pending.chunks.shift()!.length;
        }
      }
    } catch (err) {
      // Terminal geschlossen oder Lauf abgebrochen: kein harter Fehler, Ausgabe bis dahin reicht.
      pending.entry.output = `[Ausgabe unvollständig: ${String(err)}]`;
    }
  }

  private async handleEnd(e: vscode.TerminalShellExecutionEndEvent): Promise<void> {
    const pending = this.pending.get(e.execution);
    if (!pending) {
      return;
    }
    this.pending.delete(e.execution);

    // Der Stream läuft erst aus, wenn der Befehl wirklich fertig ist.
    await pending.readDone;

    const read = pending.chunks.join('').trim();
    if (!pending.entry.output) {
      pending.entry.output = read;
    } else if (read) {
      pending.entry.output = `${pending.entry.output}\n${read}`;
    }
    pending.entry.exitCode = e.exitCode;
    pending.entry.durationMs = Date.now() - pending.entry.startedAt.getTime();
    this._onCommand.fire(pending.entry);
  }

  dispose(): void {
    this.pending.clear();
    this._onCommand.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}

/** Erstes Wort des Befehls gegen die konfigurierte Liste prüfen. */
export function isWatched(command: string, watched: string[]): boolean {
  const first = firstWord(command);
  return first.length > 0 && watched.includes(first);
}

function firstWord(command: string): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  // "& az ..." (PowerShell-Aufrufoperator) und "sudo az ..." auf das Kommando reduzieren.
  while (tokens.length > 0 && (tokens[0] === '&' || tokens[0] === 'sudo')) {
    tokens.shift();
  }
  return tokens.length > 0 ? tokens[0] : '';
}
