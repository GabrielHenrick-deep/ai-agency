/**
 * Provider "opencode local": usa o OpenCode instalado na máquina
 * (`opencode serve`) como backend de modelos.
 *
 * Reaproveita as credenciais de providers já conectadas no opencode do usuário
 * (ex.: nvidia, openai, anthropic — o que estiver logado). Os modelos GRATUITOS
 * do OpenCode Zen (big-pickle, *-free) NÃO funcionam por aqui: o bloqueio é
 * aplicado a qualquer uso via API, só os clientes interativos (TUI/desktop/web)
 * do OpenCode passam. Por isso eles são omitidos da lista.
 *
 * Modelos usam o prefixo "oc/" no formato: oc/<providerID>/<modelID>
 * (ex.: "oc/nvidia/google/gemma-3-27b-it").
 *
 * Segurança: a instância serve sobe com permissões travadas ("*": "deny") e as
 * ferramentas são desativadas em cada mensagem — ela serve apenas para conversar.
 */

import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const OC_PREFIX = 'oc/';
const OC_PORT = 4199;
const OC_BASE = `http://127.0.0.1:${OC_PORT}`;

export interface OcChatMessage {
  role: string;
  content: string;
}

export function isOcModel(model: unknown): model is string {
  return typeof model === 'string' && model.startsWith(OC_PREFIX);
}

/** "oc/opencode/big-pickle" -> { providerID: 'opencode', modelID: 'big-pickle' } */
function parseOcModel(model: string): { providerID: string; modelID: string } {
  const rest = model.slice(OC_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) {
    throw new Error(`Modelo oc inválido: "${model}" (esperado "oc/<provider>/<modelo>")`);
  }
  return { providerID: rest.slice(0, slash), modelID: rest.slice(slash + 1) };
}

/* ------------------------- instância `opencode serve` ------------------------- */

let workdir = '';
let configReady = false;

/** Prepara diretório isolado + config com permissões travadas (só conversa). */
function prepareConfig(): void {
  if (configReady) return;
  workdir = mkdtempSync(join(tmpdir(), 'ai-agent-chat-oc-'));
  writeFileSync(
    join(workdir, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        permission: { '*': 'deny', read: 'allow' },
      },
      null,
      2
    )
  );
  configReady = true;
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OC_BASE}/global/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Travar permissões também via runtime (PATCH /config), além do arquivo de config. */
async function lockdownPermissions(): Promise<void> {
  try {
    await fetch(`${OC_BASE}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission: { '*': 'deny', read: 'allow' } }),
    });
  } catch {
    /* melhor esforço */
  }
}

let starting: Promise<void> | null = null;

/** Garante um `opencode serve` rodando em 127.0.0.1:4199 (sobe um se preciso). */
export async function ensureOc(): Promise<void> {
  if (await isUp()) return;

  if (!starting) {
    starting = (async () => {
      prepareConfig();
      const child = spawn(
        'opencode',
        ['serve', '--port', String(OC_PORT), '--hostname', '127.0.0.1'],
        {
          cwd: workdir,
          env: { ...process.env, OPENCODE_CONFIG: join(workdir, 'opencode.json') },
          shell: true, // Windows: resolve opencode.cmd
          stdio: 'ignore',
        }
      );
      child.unref();
      process.on('exit', () => {
        try {
          child.kill();
        } catch {
          /* já morreu */
        }
      });

      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          if (await isUp()) break;
        } catch {
          /* ainda subindo */
        }
        if (Date.now() > deadline) {
          throw new Error(
            'Timeout subindo o `opencode serve` (30s). O opencode está instalado e no PATH?'
          );
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      await lockdownPermissions();
      console.log(`opencode serve pronto em ${OC_BASE} (chat-only, permissões travadas)`);
    })().finally(() => {
      starting = null;
    });
  }
  await starting;
}

/* ------------------------------- modelos ------------------------------- */

/** Lista os modelos dos providers conectados no opencode local (prefixo oc/). */
export async function listOcModels(): Promise<string[]> {
  await ensureOc();
  const res = await fetch(`${OC_BASE}/provider`);
  if (!res.ok) throw new Error(`opencode /provider: HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const connected: string[] = data?.connected ?? [];
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of data?.all ?? []) {
    if (!connected.includes(p.id)) continue;
    const models = p.models ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids: unknown[] = Array.isArray(models) ? models.map((m: any) => m?.id) : Object.keys(models);
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue;
      // os grátis do Zen são exclusivos dos clientes interativos do OpenCode
      // (via serve respondem 403), então não vale a pena exibi-los
      if (p.id === 'opencode' && (id === 'big-pickle' || id.endsWith('-free'))) continue;
      out.push(`${OC_PREFIX}${p.id}/${id}`);
    }
  }
  return out;
}

/* -------------------------------- chat -------------------------------- */

// ferramentas desligadas em cada mensagem: a instância é só de conversa
const NO_TOOLS: Record<string, boolean> = Object.fromEntries(
  [
    'bash', 'edit', 'write', 'read', 'grep', 'glob', 'list', 'patch',
    'webfetch', 'websearch', 'task', 'todowrite', 'todoread', 'question', 'skill',
  ].map(t => [t, false])
);

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`opencode local: HTTP ${res.status}${text ? ` — ${text}` : ''}`);
  }
  return (await res.json()) as T;
}

/**
 * Chama um modelo via opencode local. Uma sessão nova por turno (descartada ao
 * final): o system prompt + o histórico vão no campo `system`, e a última
 * mensagem do usuário vai como part.
 */
export async function callOc(model: string, messages: OcChatMessage[]): Promise<string> {
  await ensureOc();
  const { providerID, modelID } = parseOcModel(model);

  const systemParts: string[] = [];
  const rest = messages.filter(m => {
    if (m.role === 'system') {
      systemParts.push(m.content);
      return false;
    }
    return true;
  });

  const history = rest
    .slice(0, -1)
    .map(m => `${m.role === 'assistant' ? 'Assistente' : 'Usuário'}: ${m.content}`)
    .join('\n\n');
  const last = rest[rest.length - 1];
  if (!last) throw new Error('opencode local: mensagem vazia');

  const system = [
    ...systemParts,
    ...(history ? [`Transcrição da conversa até aqui:\n${history}`] : []),
  ].join('\n\n');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await postJson<any>(`${OC_BASE}/session`, {
    title: 'ai-agent-chat',
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await postJson<any>(`${OC_BASE}/session/${session.id}/message`, {
      model: { providerID, modelID },
      ...(system ? { system } : {}),
      tools: NO_TOOLS,
      parts: [{ type: 'text', text: last.content }],
    });

    const err = resp?.info?.error;
    if (err) {
      throw new Error(err.data?.message ?? err.message ?? JSON.stringify(err));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (resp?.parts ?? [])
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('');
  } finally {
    // sessão de uso único: descarta pra não acumular lixo no storage do opencode
    try {
      await fetch(`${OC_BASE}/session/${session.id}`, { method: 'DELETE' });
    } catch {
      /* melhor esforço */
    }
  }
}
