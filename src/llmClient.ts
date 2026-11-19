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

/**
 * Übersetzt einen fehlgeschlagenen `fetch` in eine Meldung, die die Ursache nennt.
 * Node wirft nur `TypeError: fetch failed`; der echte Grund (ECONNREFUSED, DNS, TLS,
 * Zeitüberschreitung) steckt in `cause` — und landet sonst nie in der Oberfläche.
 */
export function describeFetchFailure(err: unknown, url: string, timeoutMs: number, model: string): Error {
  const messages: string[] = [];
  const codes: string[] = [];
  const hostPort = url.replace(/^https?:\/\//, '').split('/')[0];

  const walk = (value: unknown, depth: number): void => {
    if (!value || depth > 4) {
      return;
    }
    const e = value as {
      message?: unknown;
      code?: unknown;
      name?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof e.message === 'string' && e.message.trim().length > 0 && !messages.includes(e.message)) {
      messages.push(e.message);
    }
    if (typeof e.code === 'string' && !codes.includes(e.code)) {
      codes.push(e.code);
    }
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      codes.push('TIMEOUT');
    }
    if (Array.isArray(e.errors)) {
      for (const inner of e.errors) {
        walk(inner, depth + 1);
      }
    }
    walk(e.cause, depth + 1);
  };
  walk(err, 0);

  let hint: string;
  if (codes.includes('TIMEOUT')) {
    hint = `Keine Antwort innerhalb von ${Math.round(timeoutMs / 1000)} s — Endpunkt antwortet nicht oder rechnet zu lange.`;
  } else if (codes.includes('ECONNREFUSED')) {
    hint = `Verbindung abgelehnt: auf ${hostPort} hört nichts. Läuft der Endpunkt (z. B. der LiteLLM-Proxy)?`;
  } else if (codes.includes('ENOTFOUND')) {
    hint = `Host ${hostPort} ist nicht auflösbar (DNS) — Schreibweise der URL prüfen.`;
  } else if (codes.includes('EAI_AGAIN')) {
    hint = `DNS für ${hostPort} antwortet gerade nicht (EAI_AGAIN) — später erneut versuchen.`;
  } else if (codes.includes('ETIMEDOUT') || codes.includes('UND_ERR_CONNECT_TIMEOUT')) {
    hint = `Verbindungsaufbau zu ${hostPort} lief in eine Zeitüberschreitung — Firewall/Proxy/VPN prüfen.`;
  } else if (codes.includes('ECONNRESET') || codes.includes('UND_ERR_SOCKET') || codes.includes('EPIPE')) {
    hint = `Verbindung zu ${hostPort} wurde abgebrochen — Server oder Zwischenstelle hat zugemacht.`;
  } else if (codes.some((c) => c.startsWith('CERT_') || c === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || c === 'DEPTH_ZERO_SELF_SIGNED_CERT')) {
    hint = `TLS-Zertifikat von ${hostPort} wird abgelehnt — Zertifikatskette prüfen.`;
  } else {
    hint = `Netzwerkaufruf an ${hostPort} ist fehlgeschlagen (kein bekanntes Fehlerbild — siehe Ursache).`;
  }

  const codeText = codes.filter((c) => c !== 'TIMEOUT').join(', ');
  const causeText = messages.join(' <- ');
  const lines = [
    hint,
    `Endpoint: ${url}`,
    `Modell: ${model}`,
    causeText ? `Ursache: ${causeText}${codeText ? ` [${codeText}]` : ''}` : '',
  ].filter((line) => line.length > 0);
  return new Error(lines.join('\n'));
}

/** Kurzer Hinweis zu einem HTTP-Status, damit man nicht raten muss. */
function hintForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return ' Hinweis: Key fehlt oder gilt nicht (Einstellung linkTerminalBot.chatApiKey).';
  }
  if (status === 404) {
    return ' Hinweis: Pfad oder Modellname stimmt nicht (chatEndpoint / chatModel prüfen).';
  }
  if (status === 429) {
    return ' Hinweis: Rate-Limit oder Kontingent erschöpft — kurz warten.';
  }
  if (status >= 500) {
    return ' Hinweis: Der Endpunkt meldet einen Serverfehler.';
  }
  return '';
}

export async function chatCompletion(options: ChatRequestOptions): Promise<string> {
  const url = resolveEndpoint(options.endpoint);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Beides setzen: OpenAI-kompatible Endpunkte wollen Authorization,
    // Azure OpenAI akzeptiert api-key.
    Authorization: `Bearer ${options.apiKey}`,
    'api-key': options.apiKey,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw describeFetchFailure(err, url, timeoutMs, options.model);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText || ''}`.trim() +
        hintForStatus(response.status) +
        `\nEndpoint: ${url}\nModell: ${options.model}\nAntwort: ${body.slice(0, 500)}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`Antwort ist kein JSON (Endpoint ${url}).\nAnfang der Antwort: ${body.slice(0, 300)}`);
  }
  return extractAnswer(payload);
}
