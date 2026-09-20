/** Helpers compartilhados pelos providers em nuvem (Zen, OpenRouter). */

/** Lê um stream SSE e chama onData com o conteúdo de cada linha "data:". */
export async function iterateSse(
  body: ReadableStream<Uint8Array>,
  onData: (dataStr: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) onData(tail.slice(5).trim());
}

/** Monta um Error legível a partir de uma resposta HTTP de erro. */
export async function httpError(res: Response, label: string): Promise<Error> {
  const raw = (await res.text().catch(() => '')).slice(0, 500);
  let detail = raw;
  try {
    // os providers respondem erro em JSON; extrai só a mensagem pra não poluir a UI
    const parsed = raw ? JSON.parse(raw) : null;
    detail = parsed?.error?.message ?? parsed?.message ?? raw;
  } catch {
    /* corpo não é JSON */
  }
  return new Error(`${label}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
}
