/**
 * Integração com o OpenCode Zen (https://opencode.ai/zen).
 *
 * O Zen usa APIs diferentes por família de modelo:
 *   - OpenAI chat completions : deepseek, glm, minimax, kimi, big-pickle, mimo, ling, nemotron
 *   - Anthropic messages      : claude, qwen3.x
 *   - OpenAI responses        : gpt, grok, muse
 *   - Google generateContent  : gemini
 *
 * Este módulo decide a rota pelo ID do modelo e normaliza requests/responses
 * para o formato "Ollama-like" que o frontend já consome
 * ({ message: { role, content }, done }), incluindo streaming via SSE.
 */

import { httpError, iterateSse } from './sse.js';

const ZEN_BASE = 'https://opencode.ai/zen/v1';

/** Prefixo usado para identificar modelos do Zen (ex.: "opencode/kimi-k2.6"). */
export const ZEN_PREFIX = 'opencode/';

export interface ZenChatMessage {
  role: string;
  content: string;
}

/** Opções vindas do frontend (mesma forma das options do Ollama). */
export interface ZenOptions {
  temperature?: number;
  num_predict?: number;
}

export function isZenModel(model: unknown): model is string {
  return typeof model === 'string' && model.startsWith(ZEN_PREFIX);
}

export function zenModelId(model: string): string {
  return model.slice(ZEN_PREFIX.length);
}

/** Resolve a chave: header > body > variável de ambiente do servidor. */
export function resolveZenKey(req: {
  body?: { zenApiKey?: string };
  headers: Record<string, unknown>;
}): string {
  const header = req.headers['x-zen-key'];
  return (
    req.body?.zenApiKey ||
    (typeof header === 'string' ? header : '') ||
    process.env.OPENCODE_API_KEY ||
    ''
  );
}

/** Lista os modelos publicados no Zen (endpoint público, sem chave). */
export async function listZenModels(): Promise<string[]> {
  const res = await fetch(`${ZEN_BASE}/models`);
  if (!res.ok) throw new Error(`Zen /models: HTTP ${res.status}`);
  const data = (await res.json()) as { data?: { id?: unknown }[] };
  return (data.data ?? [])
    .map(m => m?.id)
    .filter((id): id is string => typeof id === 'string')
    // os gratuitos do Zen só funcionam de dentro do app do OpenCode
    // (chamadas externas recebem 403 "FreeTierError"), então são omitidos
    .filter(id => !id.endsWith('-free') && id !== 'big-pickle');
}

type ZenFamily = 'chat' | 'anthropic' | 'responses' | 'gemini';

/** Decide qual API do Zen usar a partir do ID do modelo. */
function zenFamily(id: string): ZenFamily {
  if (id.startsWith('claude-') || id.startsWith('qwen3.')) return 'anthropic';
  if (id.startsWith('gpt-') || id.startsWith('grok-') || id.startsWith('muse-')) return 'responses';
  if (id.startsWith('gemini-')) return 'gemini';
  return 'chat';
}

interface ZenRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function splitSystem(messages: ZenChatMessage[]) {
  const system = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const rest = messages.filter(m => m.role !== 'system');
  return { system, rest };
}

/** Monta URL, headers e body conforme a família do modelo. */
function buildRequest(
  id: string,
  messages: ZenChatMessage[],
  options: ZenOptions,
  stream: boolean,
  apiKey: string
): ZenRequestSpec {
  const auth = `Bearer ${apiKey}`;
  const json = { 'Content-Type': 'application/json', Authorization: auth };

  switch (zenFamily(id)) {
    case 'chat': {
      const body: Record<string, unknown> = { model: id, messages, stream };
      if (typeof options.temperature === 'number') body.temperature = options.temperature;
      if (typeof options.num_predict === 'number') body.max_tokens = options.num_predict;
      return { url: `${ZEN_BASE}/chat/completions`, headers: json, body };
    }

    case 'anthropic': {
      const { system, rest } = splitSystem(messages);
      const body: Record<string, unknown> = {
        model: id,
        max_tokens: options.num_predict ?? 4096,
        messages: rest.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        stream,
      };
      if (system) body.system = system;
      if (typeof options.temperature === 'number') body.temperature = options.temperature;
      return {
        url: `${ZEN_BASE}/messages`,
        headers: { ...json, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body,
      };
    }

    case 'responses': {
      const { system, rest } = splitSystem(messages);
      const body: Record<string, unknown> = {
        model: id,
        input: rest.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        store: false,
        stream,
      };
      if (system) body.instructions = system;
      if (typeof options.num_predict === 'number') body.max_output_tokens = options.num_predict;
      // sem "temperature": modelos de raciocínio (gpt-5/grok) rejeitam o campo
      return { url: `${ZEN_BASE}/responses`, headers: json, body };
    }

    case 'gemini': {
      const { system, rest } = splitSystem(messages);
      const generationConfig: Record<string, unknown> = {};
      if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature;
      if (typeof options.num_predict === 'number') generationConfig.maxOutputTokens = options.num_predict;
      const body: Record<string, unknown> = {
        contents: rest.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig,
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      return {
        url: `${ZEN_BASE}/models/${id}:${action}`,
        headers: { ...json, 'x-goog-api-key': apiKey },
        body,
      };
    }
  }
}

/** Extrai o texto completo de uma resposta não-stream, conforme a família. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFull(id: string, data: any): string {
  switch (zenFamily(id)) {
    case 'chat':
      return data?.choices?.[0]?.message?.content ?? '';
    case 'anthropic':
      return (data?.content ?? [])
        .filter((b: { type?: string }) => b?.type === 'text')
        .map((b: { text?: string }) => b.text ?? '')
        .join('');
    case 'responses': {
      if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
      const parts: string[] = [];
      for (const item of data?.output ?? []) {
        if (item?.type !== 'message') continue;
        for (const part of item.content ?? []) {
          if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
        }
      }
      return parts.join('');
    }
    case 'gemini':
      return (data?.candidates?.[0]?.content?.parts ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => p?.text ?? '')
        .join('');
  }
}

/**
 * Extrai o texto de um evento SSE durante o streaming.
 * Retorna '' para eventos sem texto e lança erro em eventos de falha.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDelta(id: string, data: any): string {
  switch (zenFamily(id)) {
    case 'chat': {
      if (data?.error) throw new Error(`Zen (${id}): ${data.error.message ?? JSON.stringify(data.error)}`);
      return data?.choices?.[0]?.delta?.content ?? '';
    }
    case 'anthropic': {
      if (data?.type === 'error') throw new Error(`Zen (${id}): ${data.error?.message ?? 'stream falhou'}`);
      if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        return data.delta.text ?? '';
      }
      return '';
    }
    case 'responses': {
      if (data?.type === 'response.failed' || data?.type === 'error') {
        throw new Error(`Zen (${id}): ${data?.response?.error?.message ?? data?.message ?? 'stream falhou'}`);
      }
      if (data?.type === 'response.output_text.delta') return data.delta ?? '';
      return '';
    }
    case 'gemini': {
      if (data?.error) throw new Error(`Zen (${id}): ${data.error.message ?? 'stream falhou'}`);
      return (data?.candidates?.[0]?.content?.parts ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => p?.text ?? '')
        .join('');
    }
  }
}

/** Chama um modelo do Zen (não-stream) e devolve o texto completo. */
export async function callZen(
  id: string,
  messages: ZenChatMessage[],
  options: ZenOptions,
  apiKey: string
): Promise<string> {
  const spec = buildRequest(id, messages, options, false, apiKey);
  const res = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify(spec.body),
  });
  if (!res.ok) throw await httpError(res, `Zen (${id})`);
  return extractFull(id, await res.json());
}

/** Faz streaming de um modelo do Zen; chama onDelta a cada trecho de texto. */
export async function streamZen(
  id: string,
  messages: ZenChatMessage[],
  options: ZenOptions,
  apiKey: string,
  onDelta: (text: string) => void
): Promise<void> {
  const spec = buildRequest(id, messages, options, true, apiKey);
  const res = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify(spec.body),
  });
  if (!res.ok) throw await httpError(res, `Zen (${id})`);
  if (!res.body) throw new Error(`Zen (${id}): resposta sem body`);

  await iterateSse(res.body, dataStr => {
    if (!dataStr || dataStr === '[DONE]') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return; // ignora linhas quebradas
    }
    const text = extractDelta(id, parsed);
    if (text) onDelta(text);
  });
}
