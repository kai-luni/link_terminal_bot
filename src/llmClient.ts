/**
 * Minimaler Client für OpenAI-kompatible Chat-Endpunkte.
 * Bewusst ohne `vscode`-Import, damit er sich außerhalb der Extension testen lässt.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequestOptions {
  /** Basis-URL (z. B. https://api.openai.com/v1) oder volle /chat/completions-URL. */
  endpoint: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** Standard: 120 s. */
  timeoutMs?: number;
}

/** Hängt den Pfad an, wenn der Nutzer nur die Basis-URL eingetragen hat. */
export function resolveEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Kein Chat-Endpunkt gesetzt (Einstellung linkTerminalBot.chatEndpoint).');
  }
  if (/\/chat\/completions$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

/** Liest den Antworttext aus einer Chat-Completions-Antwort. */
export function extractAnswer(payload: unknown): string {
  const data = payload as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text === 'string' && text.trim().length > 0) {
    return text;
  }
  const apiError = data?.error?.message;
  if (typeof apiError === 'string' && apiError.trim().length > 0) {
    throw new Error(apiError);
  }
  throw new Error('Antwort ohne Inhalt (kein choices[0].message.content).');
}

export async function chatCompletion(options: ChatRequestOptions): Promise<string> {
  const url = resolveEndpoint(options.endpoint);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Beides setzen: OpenAI-kompatible Endpunkte wollen Authorization,
    // Azure OpenAI akzeptiert api-key.
    Authorization: `Bearer ${options.apiKey}`,
    'api-key': options.apiKey,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: options.model, messages: options.messages }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`Antwort ist kein JSON: ${body.slice(0, 300)}`);
  }
  return extractAnswer(payload);
}
