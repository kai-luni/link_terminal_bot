import { ChatSettings } from './chatSettings';

type StatusSettings = Pick<ChatSettings, 'model' | 'endpoint' | 'contextCommands' | 'contextMaxTokens'>;

interface ContextStatus {
  count: number;
  totalCount: number;
  tokens: number;
}

/** Diese Funktion läuft auch im Skript der Webview und greift nur auf ihre Argumente zu. */
export function formatContextStatus(context: ContextStatus, settings: StatusSettings) {
  function formatTokens(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  const { count, totalCount, tokens } = context;
  const { model, endpoint, contextCommands, contextMaxTokens } = settings;
  const unit = count === 1 ? 'Befehl' : 'Befehle';
  const commands = totalCount > count ? `${count} von ${totalCount}` : String(count);
  return {
    summary: `Kontext · ${count} ${unit} · ${formatTokens(tokens)} / ${formatTokens(contextMaxTokens)} Tokens`,
    model: model || '(nicht gesetzt)',
    endpoint: endpoint && endpoint.trim().length > 0 ? endpoint : '(nicht gesetzt)',
    commands: `${commands} (Limit ${contextCommands})`,
    budget: `${contextMaxTokens} Tokens`,
    tokens: `${tokens} Tokens`,
  };
}
