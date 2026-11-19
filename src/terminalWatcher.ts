import * as vscode from 'vscode';
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_WATCHED_COMMANDS,
  isWatched,
  readTerminalOutput,
} from './terminalOutput';
import { TerminalCommandEntry } from './types';

export { isWatched, truncationMarker } from './terminalOutput';

interface PendingExecution {
  entry: TerminalCommandEntry;
  readDone: ReturnType<typeof readTerminalOutput>;
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
  /** Erste Wörter, die schon als "nicht beobachtet" geloggt wurden (gegen Log-Rauschen). */
  private readonly reportedSkips = new Set<string>();

  constructor(private readonly log: (type: string, data: unknown) => void = () => {}) {
    this.disposables.push(
      vscode.window.onDidChangeTerminalShellIntegration((e) => {
        this.seenShellIntegration = true;
        this.log('SHELL_INTEGRATION', {
          terminal: e.terminal.name,
          cwd: e.shellIntegration.cwd?.fsPath,
        });
      }),
      vscode.window.onDidStartTerminalShellExecution((e) => this.handleStart(e)),
      vscode.window.onDidEndTerminalShellExecution((e) => void this.handleEnd(e)),
    );
  }

  /** True, sobald VS Code für mindestens ein Terminal Shell-Integration gemeldet hat. */
  get isActive(): boolean {
    return this.seenShellIntegration;
  }

  /** Warum ein Befehl nicht beobachtet wurde — pro erstem Wort nur einmal ins Log. */
  private reportSkip(grund: string, command: string): void {
    const first = command.split(/\s+/)[0] ?? '';
    if (first.length === 0 || this.reportedSkips.has(first)) {
      return;
    }
    this.reportedSkips.add(first);
    this.log('WATCH_SKIP', { grund, erstesWort: first, beispiel: command });
  }

  private settings(): { enabled: boolean; watched: string[]; maxOutputChars: number } {
    const cfg = vscode.workspace.getConfiguration('linkTerminalBot');
    return {
      enabled: cfg.get<boolean>('enabled', true),
      watched: cfg.get<string[]>('watchedCommands', DEFAULT_WATCHED_COMMANDS),
      maxOutputChars: cfg.get<number>('maxOutputChars', DEFAULT_MAX_OUTPUT_CHARS),
    };
  }

  private handleStart(e: vscode.TerminalShellExecutionStartEvent): void {
    const { enabled, watched, maxOutputChars: configuredMax } = this.settings();
    const command = e.execution.commandLine.value.trim();
    if (!enabled) {
      this.reportSkip('deaktiviert (linkTerminalBot.enabled = false)', command);
      return;
    }
    if (!isWatched(command, watched)) {
      this.reportSkip(`erstes Wort nicht in watchedCommands (${watched.join(', ')})`, command);
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

    this.pending.set(e.execution, {
      entry,
      readDone: readTerminalOutput(() => e.execution.read(), configuredMax, (err) => {
        this.log('WATCH_ERROR', { id: entry.id, command: entry.command, fehler: String(err) });
      }),
    });
  }

  private async handleEnd(e: vscode.TerminalShellExecutionEndEvent): Promise<void> {
    const pending = this.pending.get(e.execution);
    if (!pending) {
      return;
    }
    this.pending.delete(e.execution);

    // Der Stream läuft erst aus, wenn der Befehl wirklich fertig ist.
    Object.assign(pending.entry, await pending.readDone);
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
