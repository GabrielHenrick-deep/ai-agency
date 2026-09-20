/**
 * Providers genéricos: qualquer API compatível com OpenAI chat/completions
 * (OpenRouter, Groq, Together, LM Studio, vLLM, llama.cpp, Mistral…).
 *
 * O modelo chega como "<providerId>/<modelId>"
 * (ex.: "openrouter/deepseek/deepseek-r1-0528:free") e o provider
 * (baseUrl + chave) vem configurado no body da requisição, salvo
 * nas configurações do app.
 */

import { httpError, iterateSse } from './sse.js';

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

/** Mesma forma das options do Ollama, como o frontend já envia. */
export interface ChatOptions {
  temperature?: number;
  num_predict?: number;
}

function isProviderConfig(p: unknown): p is ProviderConfig {
  return (
    !!p &&
    typeof p === 'object' &&
    typeof (p as ProviderConfig).id === 'string' &&
    typeof (p as ProviderConfig).baseUrl === 'string' &&
    (p as ProviderConfig).baseUrl.length > 0
  );
}

/** Acha o provider cujo id bate com o prefixo do modelo; null = não é provider. */
export function resolveProvider(
  model: unknown,
  providers: unknown
): { provider: ProviderConfig; modelId: string } | null {
  if (typeof model !== 'string' || !Array.isArray(providers)) return null;
  const slash = model.indexOf('/');
  if (slash <= 0) return null;
  const provider = providers
    .filter(isProviderConfig)
    .find(p => model.startsWith(`${p.id}/`));
  if (!provider) return null;
  return { provider, modelId: model.slice(slash + 1) };
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

async function chat(
  provider: ProviderConfig,
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions,
  stream: boolean
): Promise<Response> {
  const body: Record<string, unknown> = { model: modelId, messages, stream };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (typeof options.num_predict === 'number') body.max_tokens = options.num_predict;

  const res = await fetch(`${normalizeBase(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey ?? ''}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, provider.name || provider.id);
  return res;
}

/** Chamada não-stream; devolve o texto completo. */
export async function callProvider(
  provider: ProviderConfig,
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<string> {
  const res = await chat(provider, modelId, messages, options, false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/** Streaming; chama onDelta a cada trecho de texto. */
export async function streamProvider(
  provider: ProviderConfig,
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions,
  onDelta: (text: string) => void
): Promise<void> {
  const res = await chat(provider, modelId, messages, options, true);
  if (!res.body) throw new Error(`${provider.name || provider.id}: resposta sem body`);

  await iterateSse(res.body, dataStr => {
    if (!dataStr || dataStr === '[DONE]') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return; // ignora linhas quebradas
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (parsed as any)?.error;
    if (err) {
      throw new Error(`${provider.name || provider.id}: ${err.message ?? JSON.stringify(err)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (parsed as any)?.choices?.[0]?.delta?.content;
    if (typeof text === 'string' && text) onDelta(text);
  });
}

/** Lista os modelos do provider via GET <baseUrl>/models (padrão OpenAI). */
export async function listProviderModels(provider: ProviderConfig): Promise<string[]> {
  const res = await fetch(`${normalizeBase(provider.baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${provider.apiKey ?? ''}` },
  });
  if (!res.ok) throw await httpError(res, provider.name || provider.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const items: unknown[] = Array.isArray(data?.data) ? data.data : [];
  return items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => m?.id)
    .filter((id): id is string => typeof id === 'string');
}
