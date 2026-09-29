import * as vscode from 'vscode';
import { ChatSettings, ChatViewProvider } from './chatView';
import { DEFAULT_LOG_PATH, writeLog } from './fileLog';
import { SessionContext } from './sessionContext';
import { TerminalWatcher } from './terminalWatcher';
import { TerminalCommandEntry } from './types';

let channel: vscode.OutputChannel | undefined;
let watcher: TerminalWatcher | undefined;
let context: SessionContext | undefined;
let chat: ChatViewProvider | undefined;

export function activate(extensionContext: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Link Terminal Bot');
  watcher = new TerminalWatcher(debugLog);
  context = new SessionContext();
  chat = new ChatViewProvider(context, readChatSettings, insertIntoTerminal, logLine, debugLog);

  extensionContext.subscriptions.push(
    channel,
    watcher,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    watcher.onCommand((entry) => {
      context?.add(entry, historySize());
      logEntry(entry);
      debugLog('COMMAND', {
        id: entry.id,
        command: entry.command,
        exitCode: entry.exitCode,
        durationMs: entry.durationMs,
        cwd: entry.cwd,
        output: entry.output,
      });
      chat?.notifyContext();
      void chat?.autoAdvise(entry);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('linkTerminalBot')) {
        debugLog('CONFIG_CHANGE', describeSettings(readChatSettings()));
        logLine('Einstellungen geändert.');
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      debugLog('WINDOW_STATE', { focused: state.focused, activeTerminal: vscode.window.activeTerminal?.name });
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      debugLog('ACTIVE_TERMINAL', { name: terminal?.name ?? null });
    }),
    { dispose: () => loggingGuard?.dispose() },
    vscode.commands.registerCommand('linkTerminalBot.openChat', () =>
      vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`),
    ),
    vscode.commands.registerCommand('linkTerminalBot.showContext', showContext),
    vscode.commands.registerCommand('linkTerminalBot.clearContext', clearContext),
  );

  installErrorHandlers();
  debugLog('SESSION', sessionInfo(readChatSettings()));
  channel.appendLine('Link Terminal Bot aktiv.');
  channel.appendLine('Chat: Seitenleiste rechts -> Link Terminal Bot (oder Befehl "Link Terminal Bot: Chat öffnen").');
  channel.appendLine('Beobachtet wird nur, wenn im Terminal Shell-Integration aktiv ist (Standard in VS Code).');
  channel.appendLine(`Debug-Log: ${DEFAULT_LOG_PATH}`);
}

export function deactivate(): void {
  debugLog('SESSION_END', 'Extension wird deaktiviert.');
  loggingGuard?.dispose();
  channel = undefined;
  watcher = undefined;
  context = undefined;
  chat = undefined;
}

/** Fängt Fehler ab, die sonst nur in der Debug-Konsole landen würden. */
let loggingGuard: { dispose: () => void } | undefined;

function installErrorHandlers(): void {
  const onUncaught = (err: Error): void => {
    debugLog('UNCAUGHT_EXCEPTION', { fehler: String(err), stack: err.stack });
    channel?.appendLine(`FEHLER (uncaught): ${String(err)}`);
  };
  const onRejection = (reason: unknown): void => {
    debugLog('UNHANDLED_REJECTION', { grund: String(reason) });
    channel?.appendLine(`FEHLER (unhandled rejection): ${String(reason)}`);
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  loggingGuard = {
    dispose: () => {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onRejection);
    },
  };
}

/** Was beim Start gilt — ohne Key, aber mit der Info, ob einer gesetzt ist. */
function describeSettings(settings: ChatSettings, session?: SessionContext): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration('linkTerminalBot');
  return {
    endpoint: settings.endpoint || '(leer)',
    apiKeyGesetzt: settings.apiKey.trim().length > 0,
    modell: settings.model,
    autoAdvise: settings.autoAdvise,
    autoAdviseSekunden: settings.autoAdviseSeconds,
    chatContextCommands: settings.contextCommands,
    watchedCommands: cfg.get<string[]>('watchedCommands', ['az', 'azd']),
    maxOutputChars: cfg.get<number>('maxOutputChars', 4000),
    historySize: cfg.get<number>('historySize', 20),
    aktiv: cfg.get<boolean>('enabled', true),
    befehleImKontext: session?.all.length ?? 0,
  };
}

/** Umgebung plus wirksame Einstellungen — der Block, der beim Debuggen zuerst fehlt. */
function sessionInfo(settings: ChatSettings): Record<string, unknown> {
  return {
    extensionVersion: vscode.extensions.getExtension('kai-luni.link-terminal-bot')?.packageJSON?.version ?? '?',
    vscode: vscode.version,
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    shellIntegrationAktiv: watcher?.isActive ?? false,
    terminal: vscode.window.activeTerminal?.name ?? null,
    logPfad: DEFAULT_LOG_PATH,
    ...describeSettings(settings, context),
  };
}

function logEntry(entry: TerminalCommandEntry): void {
  channel?.appendLine(
    `[${entry.id}] $ ${entry.command}   (exit ${entry.exitCode ?? '?'}, ${entry.durationMs ?? '?'} ms)`,
  );
}

function logLine(message: string): void {
  channel?.appendLine(message);
  void writeLog('INFO', message);
}

/** Schreibt einen Block in die Debug-Log-Datei (~/link-terminal-bot.log). */
function debugLog(type: string, data: unknown): void {
  void writeLog(type, data);
}

/** Schreibt einen Befehl ins aktive Terminal, ohne ihn auszuführen (Enter drückt der Nutzer). */
function insertIntoTerminal(command: string): void {
  const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal('Terminal');
  terminal.show();
  terminal.sendText(command, false);
  channel?.appendLine(`→ ins Terminal eingefügt: ${command}`);
}

function showContext(): void {
  if (!context || !channel) {
    return;
  }
  const entries = context.all;
  channel.appendLine('');
  channel.appendLine(`--- Sitzungskontext (${entries.length} beobachtete Befehle) ---`);
  if (entries.length === 0) {
    channel.appendLine('(leer)');
  }
  for (const entry of entries) {
    channel.appendLine(`[${entry.id}] $ ${entry.command}   (exit ${entry.exitCode ?? '?'})`);
    if (entry.output) {
      channel.appendLine(indent(entry.output));
    }
  }
  channel.appendLine('--- Ende ---');
  channel.show(true);
}

function clearContext(): void {
  context?.clear();
  chat?.notifyContext();
  channel?.appendLine('Sitzungskontext geleert.');
}

function readChatSettings(): ChatSettings {
  const cfg = vscode.workspace.getConfiguration('linkTerminalBot');
  const mode = cfg.get<string>('autoAdvise', 'always');
  return {
    endpoint: cfg.get<string>('chatEndpoint', ''),
    apiKey: cfg.get<string>('chatApiKey', ''),
    model: cfg.get<string>('chatModel', 'gpt-4o-mini'),
    contextCommands: cfg.get<number>('chatContextCommands', 5),
    autoAdvise: mode === 'off' || mode === 'always' ? mode : 'errors',
    autoAdviseSeconds: cfg.get<number>('autoAdviseSeconds', 8),
  };
}

function historySize(): number {
  return vscode.workspace.getConfiguration('linkTerminalBot').get<number>('historySize', 20);
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
}
