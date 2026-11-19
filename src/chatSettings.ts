import { AutoAdviseMode } from './autoAdvisePolicy';
import { ChatApiMode } from './llmClient';

export interface ChatSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  apiMode: ChatApiMode;
  webSearch: boolean;
  webSearchAutoAdvise: boolean;
  contextCommands: number;
  contextMaxTokens: number;
  autoAdvise: AutoAdviseMode;
  autoAdviseSeconds: number;
}

/** Nur diese Einstellungen dürfen an die Webview gehen. */
export function webviewConfigMessage(settings: ChatSettings) {
  const { model, endpoint, apiMode, webSearch, contextCommands, contextMaxTokens } = settings;
  return {
    type: 'config' as const,
    settings: { model, endpoint, apiMode, webSearch, contextCommands, contextMaxTokens },
  };
}
