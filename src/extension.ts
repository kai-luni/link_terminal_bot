import * as vscode from 'vscode';
import { Advisor, RuleBasedAdvisor } from './advisor';
import { SessionContext } from './sessionContext';
import { TerminalWatcher } from './terminalWatcher';
import { TerminalCommandEntry } from './types';

let channel: vscode.OutputChannel | undefined;
let watcher: TerminalWatcher | undefined;
let context: SessionContext | undefined;
let advisor: Advisor | undefined;

export function activate(extensionContext: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('Link Terminal Bot');
  watcher = new TerminalWatcher();
  context = new SessionContext();
  advisor = new RuleBasedAdvisor();

  // TODO(Berater): Hier hängt später der LLM-Berater drin (Azure MCP Server / Modell-Endpoint).
  // Er implementiert dieselbe Schnittstelle `Advisor` und bekommt `entry` + `context.all`.

  extensionContext.subscriptions.push(
    channel,
    watcher,
    watcher.onCommand((entry) => void handleCommand(entry)),
    vscode.commands.registerCommand('linkTerminalBot.showContext', showContext),
    vscode.commands.registerCommand('linkTerminalBot.adviseLast', adviseLast),
    vscode.commands.registerCommand('linkTerminalBot.clearContext', clearContext),
  );

  channel.appendLine('Link Terminal Bot aktiv — beobachtet: az / azd (Einstellung linkTerminalBot.watchedCommands).');
  channel.appendLine('Beobachtet wird nur, wenn im Terminal Shell-Integration aktiv ist (Standard in VS Code).');
}

export function deactivate(): void {
  channel = undefined;
  watcher = undefined;
  context = undefined;
  advisor = undefined;
}

async function handleCommand(entry: TerminalCommandEntry): Promise<void> {
  if (!context || !advisor || !channel) {
    return;
  }
  context.add(entry, historySize());
  channel.appendLine(
    `[${entry.id}] $ ${entry.command}   (exit ${entry.exitCode ?? '?'}, ${entry.durationMs ?? '?'} ms)`,
  );

  const advice = await advisor.advise(entry, context.all);
  if (advice) {
    channel.appendLine(`   → ${advice.summary}`);
    if (advice.detail) {
      channel.appendLine(`     ${advice.detail}`);
    }
  }
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

async function adviseLast(): Promise<void> {
  if (!context || !advisor || !channel) {
    return;
  }
  const last = context.last;
  if (!last) {
    channel.appendLine('Noch kein az-Befehl beobachtet.');
    channel.show(true);
    return;
  }
  const advice = await advisor.advise(last, context.all);
  channel.appendLine('');
  channel.appendLine(`Hinweis zu [${last.id}] $ ${last.command}`);
  channel.appendLine(advice ? `   → ${advice.summary}` : '   (kein Hinweis)');
  if (advice?.detail) {
    channel.appendLine(`     ${advice.detail}`);
  }
  channel.show(true);
}

function clearContext(): void {
  context?.clear();
  channel?.appendLine('Sitzungskontext geleert.');
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
