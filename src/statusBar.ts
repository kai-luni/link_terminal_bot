import * as vscode from 'vscode';

/** Was das Icon gerade zeigt. */
export type StatusState = 'aus' | 'aktiv' | 'wissen';

const COLOR_BLUE = new vscode.ThemeColor('linkTerminalBot.statusBarActive');
const COLOR_GREEN = new vscode.ThemeColor('linkTerminalBot.statusBarKnowledge');
const COLOR_OFF = new vscode.ThemeColor('linkTerminalBot.statusBarOff');

/**
 * Statusleisten-Icon unten rechts.
 *
 * - grau: Beobachtung aus (`linkTerminalBot.enabled = false`)
 * - blau: aktiv, aber keine `azure_knowledge.md` im Workspace
 * - grün: aktiv und Azure-Wissen geladen
 *
 * Klick öffnet den Chat (`linkTerminalBot.openChat`). Die Farben sind feste
 * Hex-Werte, weil die Standard-Theme-Farben kein Grün für Statusleisten kennen.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: StatusState = 'aktiv';
  private knowledgePath: string | undefined;
  private knowledgeChars = 0;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'linkTerminalBot.openChat';
    this.item.name = 'Link Terminal Bot';
    this.item.accessibilityInformation = { label: 'Link Terminal Bot' };
    this.item.show();
    this.render();
  }

  /** Beobachtung an/aus. */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.state = 'aus';
      this.knowledgePath = undefined;
      this.knowledgeChars = 0;
    } else if (this.state === 'aus') {
      this.state = this.knowledgePath ? 'wissen' : 'aktiv';
    }
    this.render();
  }

  /** Ergebnis der Suche nach `azure_knowledge.md` (`undefined` = keine Datei). */
  setKnowledge(loaded: { filePath: string; content: string } | undefined, error?: string): void {
    this.knowledgePath = loaded?.filePath;
    this.knowledgeChars = loaded?.content.length ?? 0;
    // Bei ausgeschalteter Beobachtung bleibt das Icon grau, auch wenn die Datei da ist.
    if (this.state !== 'aus') {
      this.state = loaded ? 'wissen' : 'aktiv';
    }
    this.render(error);
  }

  /** Nur die Datei ist verschwunden/geändert — Zustand neu setzen, Text bleibt. */
  get currentState(): StatusState {
    return this.state;
  }

  private render(error?: string): void {
    switch (this.state) {
      case 'aus':
        this.item.text = '$(circle-slash) Terminal Bot';
        this.item.backgroundColor = COLOR_OFF;
        this.item.tooltip = 'Link Terminal Bot: Beobachtung aus (linkTerminalBot.enabled = false)';
        break;
      case 'wissen':
        this.item.text = '$(hubot) Terminal Bot';
        this.item.backgroundColor = COLOR_GREEN;
        this.item.tooltip = this.knowledgeTooltip('Azure-Wissen geladen');
        break;
      default:
        this.item.text = '$(hubot) Terminal Bot';
        this.item.backgroundColor = COLOR_BLUE;
        this.item.tooltip = error
          ? `Link Terminal Bot aktiv — Azure-Wissen nicht lesbar: ${error}`
          : 'Link Terminal Bot aktiv — keine azure_knowledge.md im Workspace';
        break;
    }
  }

  private knowledgeTooltip(title: string): vscode.MarkdownString {
    const text = new vscode.MarkdownString();
    text.appendMarkdown(`**${title}**\n\n`);
    if (this.knowledgePath) {
      text.appendMarkdown(`\`${this.knowledgePath}\`\n\n${this.knowledgeChars} Zeichen im Prompt\n\n`);
    }
    text.appendMarkdown('Klick öffnet den Chat');
    return text;
  }

  dispose(): void {
    this.item.dispose();
  }
}
