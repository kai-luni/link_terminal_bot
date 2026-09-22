import * as vscode from 'vscode';
import { ChatSettings, ChatViewProvider } from './chatView';
import { SessionContext } from './sessionContext';
import { TerminalWatcher } from './terminalWatcher';
import { TerminalCommandEntry } from './types';

let channel: vscode.OutputChannel | undefined;
let watcher: TerminalWatcher | undefined;
let context: SessionContext | undefined;
let chat: ChatViewProvider | undefined;

export function activate(extensionContext: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Link Terminal Bot');
  watcher = new TerminalWatcher();
  context = new SessionContext();
  chat = new ChatViewProvider(context, readChatSettings, insertIntoTerminal, logLine);

  extensionContext.subscriptions.push(
    channel,
    watcher,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    watcher.onCommand((entry) => {
      context?.add(entry, historySize());
      logEntry(entry);
      chat?.notifyContext();
      void chat?.autoAdvise(entry);
    }),
    vscode.commands.registerCommand('linkTerminalBot.openChat', () =>
      vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`),
    ),
    vscode.commands.registerCommand('linkTerminalBot.showContext', showContext),
    vscode.commands.registerCommand('linkTerminalBot.clearContext', clearContext),
  );

  channel.appendLine('Link Terminal Bot aktiv.');
  channel.appendLine('Chat: Seitenleiste rechts -> Link Terminal Bot (oder Befehl "Link Terminal Bot: Chat öffnen").');
  channel.appendLine('Beobachtet wird nur, wenn im Terminal Shell-Integration aktiv ist (Standard in VS Code).');
}

export function deactivate(): void {
  channel = undefined;
  watcher = undefined;
  context = undefined;
  chat = undefined;
}

function logEntry(entry: TerminalCommandEntry): void {
  channel?.appendLine(
    `[${entry.id}] $ ${entry.command}   (exit ${entry.exitCode ?? '?'}, ${entry.durationMs ?? '?'} ms)`,
  );
}

function logLine(message: string): void {
  channel?.appendLine(message);
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
