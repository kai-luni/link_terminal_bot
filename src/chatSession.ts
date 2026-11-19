import { buildAutoMessages, repeatedFailure, shouldAutoAdvise } from './autoAdvisePolicy';
import { ChatSettings } from './chatSettings';
import { renderContext } from './contextBudget';
import { ChatMessage, ChatRequestOptions, chatCompletion } from './llmClient';
import { SYSTEM_PROMPT, isSilent } from './prompt';
import { SessionContext } from './sessionContext';
import { TerminalCommandEntry } from './types';

interface ChatSessionDependencies {
  context: SessionContext;
  settings: () => ChatSettings;
  loadKnowledge: () => Promise<string | undefined>;
  post: (message: Record<string, unknown>) => void;
  log: (message: string) => void;
  debugLog: (type: string, data: unknown) => void;
  request?: (options: ChatRequestOptions) => Promise<string>;
}

/** Koordiniert Fragen, automatische Hinweise und den Verlauf der Chat-Ansicht. */
export class ChatSession {
  private history: ChatMessage[] = [];
  private historyEpoch = 0;
  private visible = false;
  private lastAutoAt = -Infinity;
  /** Die Nutzerfrage reserviert die Sperre schon während sie auf den Auto-Lauf wartet. */
  private asking = false;
  private activeAuto: Promise<void> | undefined;
  private discardAuto = false;
  private pendingEntry: TerminalCommandEntry | undefined;
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly request: (options: ChatRequestOptions) => Promise<string>;

  constructor(private readonly deps: ChatSessionDependencies) {
    this.request = deps.request ?? chatCompletion;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.clearPending();
      this.discardAuto = true;
    }
  }

  noteUserAction(): void {
    this.lastAutoAt = -Infinity;
    this.deps.log('Befehl aus dem Chat eingefügt — der nächste Hinweis kommt ohne Wartezeit.');
    this.deps.debugLog('AUTO_COOLDOWN_RESET', 'Einfügen aus dem Chat');
  }

  clearHistory(): void {
    this.history = [];
    this.historyEpoch += 1;
    this.discardAuto = true;
    this.deps.post({ type: 'cleared' });
  }

  private clearPending(): void {
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = undefined;
    this.pendingEntry = undefined;
  }

  private async resumePending(skipCooldown = false): Promise<void> {
    if (!this.pendingEntry || this.asking || this.activeAuto) {
      return;
    }
    const entry = this.pendingEntry;
    this.clearPending();
    await this.autoAdvise(entry, skipCooldown);
  }

  async autoAdvise(entry: TerminalCommandEntry, skipCooldown = false): Promise<void> {
    if (!this.visible) {
      return;
    }
    const { settings: readSettings, log, debugLog } = this.deps;
    const settings = readSettings();
    if (!shouldAutoAdvise(settings.autoAdvise, entry.exitCode)) {
      if (settings.autoAdvise === 'errors') {
        debugLog('AUTO_SKIP', { grund: 'Modus errors, Befehl war erfolgreich', entry });
      }
      return;
    }
    if (this.asking || this.activeAuto) {
      this.pendingEntry = entry;
      log(`[${entry.id}] Hinweis zurückgestellt — es läuft noch eine Anfrage.`);
      debugLog('AUTO_DEFER', { entry });
      return;
    }
    const cooldownMs = Math.max(0, settings.autoAdviseSeconds) * 1000;
    const elapsed = Date.now() - this.lastAutoAt;
    if (!skipCooldown && elapsed < cooldownMs) {
      const remainingMs = cooldownMs - elapsed;
      this.clearPending();
      this.pendingEntry = entry;
      this.cooldownTimer = setTimeout(() => {
        this.cooldownTimer = undefined;
        void this.resumePending(true);
      }, remainingMs);
      log(
        `[${entry.id}] Hinweis zurückgestellt — Mindestabstand ${settings.autoAdviseSeconds}s noch nicht um (${Math.round(elapsed / 1000)}s vergangen, Nachzug in ${Math.ceil(remainingMs / 1000)}s).`,
      );
      debugLog('AUTO_DEFER', {
        grund: 'Mindestabstand noch nicht um',
        vergangenSekunden: Math.round(elapsed / 1000),
        restMs: remainingMs,
        einstellungSekunden: settings.autoAdviseSeconds,
        entry,
      });
      return;
    }

    this.clearPending();
    this.discardAuto = false;
    this.lastAutoAt = Date.now();
    this.activeAuto = this.runAutoAdvise(entry, settings);
    try {
      await this.activeAuto;
    } finally {
      this.activeAuto = undefined;
      await this.resumePending();
    }
  }

  private async runAutoAdvise(entry: TerminalCommandEntry, settings: ChatSettings): Promise<void> {
    const { context, loadKnowledge, log, debugLog, post } = this.deps;
    try {
      const knowledge = await loadKnowledge();
      if (this.discardAuto) {
        return;
      }
      const messages = buildAutoMessages(
        entry, context.all, this.history, settings.contextCommands, settings.contextMaxTokens, knowledge,
      );
      debugLog('AUTO_REQUEST', { model: settings.model, entry, messages });
      const answer = await this.request({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
        apiMode: settings.apiMode,
        webSearch: settings.webSearch && settings.webSearchAutoAdvise,
        onWebSearchUsage: usage => debugLog('AUTO_WEB_SEARCH_USAGE', { entryId: entry.id, ...usage }),
      });
      const silent = isSilent(answer);
      debugLog('AUTO_ANSWER', { entryId: entry.id, silent, answer });
      if (this.discardAuto) {
        log(`[${entry.id}] automatischer Hinweis verworfen.`);
        debugLog('AUTO_DROP', { entryId: entry.id, answer });
        return;
      }
      if (silent) {
        log(`[${entry.id}] $ ${entry.command} -> exit ${entry.exitCode ?? '?'}: kein Hinweis`);
        return;
      }

      const wiederholung = repeatedFailure(answer, context.all);
      const text = wiederholung?.text ?? answer;
      this.history.push({ role: 'assistant', content: text });
      post({
        type: 'answer',
        text,
        auto: true,
        label: `automatisch · $ ${entry.command} (exit ${entry.exitCode ?? '?'})`,
      });
      if (wiederholung) {
        log(`[${entry.id}] Wiederholung unterdrückt: $ ${wiederholung.entry.command}`);
        debugLog('AUTO_REPEAT', { entryId: entry.id, command: wiederholung.entry.command, answer });
      } else {
        log(`[${entry.id}] automatischer Hinweis: ${answer.split('\n')[0]}`);
      }
    } catch (err) {
      // Ein automatischer Hinweis darf den Ablauf nicht stören — nur ins Log.
      log(`[${entry.id}] automatischer Hinweis fehlgeschlagen: ${String(err)}`);
      debugLog('AUTO_ERROR', { entryId: entry.id, fehler: String(err) });
      this.lastAutoAt = -Infinity;
    }
  }

  async ask(question: string): Promise<void> {
    const { context, settings: readSettings, loadKnowledge, post, log, debugLog } = this.deps;
    if (this.asking) {
      log('Frage ignoriert — die vorige Antwort läuft noch.');
      post({ type: 'error', text: 'Es läuft noch eine Antwort. Bitte kurz warten.' });
      return;
    }

    const settings = readSettings();
    const epoch = this.historyEpoch;
    const previous = this.history;
    this.asking = true;
    this.discardAuto = true;
    post({ type: 'busy', busy: true });
    try {
      // Die Nutzerfrage hat Vorrang, wartet aber auf das Ende des laufenden Aufrufs.
      if (this.activeAuto) {
        await this.activeAuto;
      }
      if (!this.visible || this.historyEpoch !== epoch) {
        return;
      }
      const knowledge = await loadKnowledge();
      if (!this.visible || this.historyEpoch !== epoch) {
        return;
      }
      const terminalContext = renderContext(context.all, settings.contextCommands, settings.contextMaxTokens);
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...previous,
        {
          role: 'user',
          content: `${question}\n\n${terminalContext}${knowledge ? `\n\n${knowledge}` : ''}`,
        },
      ];
      debugLog('ASK', { model: settings.model, frage: question, messages });
      const answer = await this.request({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
        apiMode: settings.apiMode,
        webSearch: settings.webSearch,
        onWebSearchUsage: usage => {
          debugLog('WEB_SEARCH_USAGE', { frage: question, ...usage });
          if (usage.used && this.historyEpoch === epoch) {
            post({ type: 'searchUsage', count: usage.requests });
          }
        },
      });
      debugLog('ANSWER', { frage: question, answer });
      if (this.historyEpoch === epoch) {
        this.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
        post({ type: 'answer', text: answer });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugLog('ERROR', { frage: question, fehler: message });
      if (this.historyEpoch === epoch) {
        post({ type: 'error', text: message });
      }
    } finally {
      this.asking = false;
      post({ type: 'busy', busy: false });
      void this.resumePending();
    }
  }
}
