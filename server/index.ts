import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { initDb, pool } from './db.js';
import {
  callZen,
  isZenModel,
  listZenModels,
  resolveZenKey,
  streamZen,
  zenModelId,
  ZEN_PREFIX,
} from './zen.js';
import {
  callProvider,
  listProviderModels,
  resolveProvider,
  streamProvider,
} from './providers.js';
import { callOc, isOcModel, listOcModels } from './opencodeLocal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

app.use(cors());
app.use(express.json({ limit: '6mb' })); // sessões inteiras podem ser grandes
app.use(express.static(join(__dirname, '../dist')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ollamaUrl: OLLAMA_URL });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { model, messages, options } = req.body;
    console.log('Chat request:', { model, messagesCount: messages?.length, options });

    if (isZenModel(model)) {
      const apiKey = resolveZenKey(req);
      if (!apiKey) {
        res.status(400).json({
          error: 'Chave do OpenCode Zen ausente',
          details: 'Cole sua chave em Ajustes › OpenCode Zen (crie em opencode.ai/zen).',
        });
        return;
      }
      const content = await callZen(zenModelId(model), messages, options ?? {}, apiKey);
      res.json({
        model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content },
        done: true,
      });
      return;
    }

    // opencode local (modelos grátis via opencode serve da máquina): modelos "oc/<provider>/<modelo>"
    if (isOcModel(model)) {
      const content = await callOc(model, messages);
      res.json({
        model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content },
        done: true,
      });
      return;
    }

    // providers genéricos (OpenAI-compatible): modelo "<idProvider>/<modelo>"
    const found = resolveProvider(model, req.body.providers);
    if (found) {
      if (!found.provider.apiKey) {
        res.status(400).json({
          error: `Chave do provider "${found.provider.name || found.provider.id}" ausente`,
          details: 'Configure a API key em Ajustes › Providers.',
        });
        return;
      }
      const content = await callProvider(found.provider, found.modelId, messages, options ?? {});
      res.json({
        model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content },
        done: true,
      });
      return;
    }

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options }),
    });

    console.log('Ollama response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ollama error response:', errorText);
      throw new Error(`Ollama error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Ollama response data:', JSON.stringify(data).slice(0, 200));
    res.json(data);
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to communicate with model', details: error.message });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  try {
    const { model, messages, options } = req.body;

    if (isZenModel(model)) {
      const apiKey = resolveZenKey(req);
      if (!apiKey) {
        res.status(400).json({
          error: 'Chave do OpenCode Zen ausente',
          details: 'Cole sua chave em Ajustes › OpenCode Zen (crie em opencode.ai/zen).',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const emit = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        await streamZen(zenModelId(model), messages, options ?? {}, apiKey, delta => {
          // mesmo formato dos chunks do Ollama que o frontend já consome
          emit({ model, message: { role: 'assistant', content: delta }, done: false });
        });
      } catch (err: any) {
        emit({
          model,
          message: { role: 'assistant', content: `\n\n\n(Erro no OpenCode Zen: ${err?.message ?? 'falha desconhecida'})` },
          done: true,
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // opencode local (sem streaming incremental por ora: resposta vai de uma vez)
    if (isOcModel(model)) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const emit = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        const content = await callOc(model, messages);
        emit({ model, message: { role: 'assistant', content }, done: true });
      } catch (err: any) {
        emit({
          model,
          message: {
            role: 'assistant',
            content: `\n\n\n(Erro no opencode local: ${err?.message ?? 'falha desconhecida'})`,
          },
          done: true,
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // providers genéricos (OpenAI-compatible)
    const found = resolveProvider(model, req.body.providers);
    if (found) {
      if (!found.provider.apiKey) {
        res.status(400).json({
          error: `Chave do provider "${found.provider.name || found.provider.id}" ausente`,
          details: 'Configure a API key em Ajustes › Providers.',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const emit = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

      try {
        await streamProvider(found.provider, found.modelId, messages, options ?? {}, delta => {
          emit({ model, message: { role: 'assistant', content: delta }, done: false });
        });
      } catch (err: any) {
        emit({
          model,
          message: {
            role: 'assistant',
            content: `\n\n\n(Erro no provider ${found.provider.name || found.provider.id}: ${err?.message ?? 'falha desconhecida'})`,
          },
          done: true,
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch {
          // Ignore parse errors for incomplete chunks
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Stream error:', error);
    res.status(500).write(`data: ${JSON.stringify({ error: 'Stream failed', details: error.message })}\n\n`);
    res.end();
  }
});

/* ---------- atas das reuniões (Postgres) ---------- */

app.post('/api/meetings', async (req, res) => {
  try {
    const { topic, turns } = req.body as {
      topic: string;
      turns: { agentId: string; agentName: string; text: string }[];
    };
    if (!topic || !Array.isArray(turns)) {
      res.status(400).json({ error: 'topic e turns são obrigatórios' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query('INSERT INTO meetings (topic) VALUES ($1) RETURNING id', [topic]);
      const id: number = r.rows[0].id;
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        await client.query(
          'INSERT INTO turns (meeting_id, agent_id, agent_name, text, position) VALUES ($1, $2, $3, $4, $5)',
          [id, t.agentId, t.agentName, t.text, i]
        );
      }
      await client.query('COMMIT');
      res.json({ id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Save meeting error:', error);
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

app.get('/api/meetings', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10) || 10, 50);
    const r = await pool.query(
      `SELECT m.id, m.topic, m.created_at, COUNT(t.id) AS turns
       FROM meetings m LEFT JOIN turns t ON t.meeting_id = m.id
       GROUP BY m.id ORDER BY m.id DESC LIMIT $1`,
      [limit]
    );
    res.json({ meetings: r.rows });
  } catch (error: any) {
    console.error('List meetings error:', error);
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

app.get('/api/meetings/last', async (_req, res) => {
  try {
    const m = await pool.query('SELECT id, topic, created_at FROM meetings ORDER BY id DESC LIMIT 1');
    if (m.rows.length === 0) {
      res.json({ meeting: null });
      return;
    }
    const id: number = m.rows[0].id;
    const t = await pool.query(
      'SELECT agent_id, agent_name, text FROM turns WHERE meeting_id = $1 ORDER BY position ASC',
      [id]
    );
    res.json({
      meeting: {
        id: m.rows[0].id,
        topic: m.rows[0].topic,
        created_at: m.rows[0].created_at,
        turns: t.rows.map(r => ({ agentId: r.agent_id, agentName: r.agent_name, text: r.text })),
      },
    });
  } catch (error: any) {
    console.error('Last meeting error:', error);
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

// ata completa por id (registrada DEPOIS de /api/meetings/last p/ não capturar "last")
app.get('/api/meetings/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'id inválido' });
      return;
    }
    const m = await pool.query('SELECT id, topic, created_at FROM meetings WHERE id = $1', [id]);
    if (m.rows.length === 0) {
      res.status(404).json({ error: 'Reunião não encontrada' });
      return;
    }
    const t = await pool.query(
      'SELECT agent_id, agent_name, text FROM turns WHERE meeting_id = $1 ORDER BY position ASC',
      [id]
    );
    res.json({
      meeting: {
        id,
        topic: m.rows[0].topic,
        created_at: m.rows[0].created_at,
        turns: t.rows.map(r => ({ agentId: r.agent_id, agentName: r.agent_name, text: r.text })),
      },
    });
  } catch (error: any) {
    console.error('Get meeting error:', error);
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

/* ---------- workspace: arquivos entregues pelos agentes (modo tarefa 🛠️) ---------- */

/** Caminho relativo seguro: sem "..", sem raiz absoluta, sem unidade C:. */
function safeRelPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const clean = p.replace(/\\/g, '/').trim();
  if (
    !clean ||
    clean.length > 200 ||
    clean.startsWith('/') ||
    clean.includes('..') ||
    /^[a-zA-Z]:/.test(clean)
  ) {
    return null;
  }
  const segs = clean.split('/');
  if (segs.some(s => !s || s === '.')) return null;
  return clean;
}

app.post('/api/workspace/save', async (req, res) => {
  try {
    const { files } = req.body as { files?: { path: string; content: string }[] };
    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'files (array) é obrigatório' });
      return;
    }
    const root = join(process.cwd(), 'workspace');
    const saved: string[] = [];
    for (const f of files.slice(0, 30)) {
      const rel = safeRelPath(f?.path);
      if (!rel || typeof f.content !== 'string' || f.content.length > 500_000) continue;
      const dest = join(root, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.content, 'utf-8');
      saved.push(rel);
    }
    res.json({ saved });
  } catch (error: any) {
    console.error('Workspace save error:', error);
    res.status(500).json({ error: 'Falha ao salvar arquivos', details: error.message });
  }
});

/**
 * Executa um comando do agente DENTRO de workspace/ e devolve a saída.
 * Travas: timeout de 90s, buffer limitado, e uma blocklist de comandos
 * destrutivos óbvios (o resto é responsabilidade de quem aperta ▶).
 */
const BLOCKED_CMD =
  /\b(mkfs|shutdown|reboot|poweroff)\b|del\s+\/[fsq]|erase\s+\/[fsq]|rd\s+\/[sq]|rmdir\s+\/[sq]|format\s+[a-z]:/i;

app.post('/api/workspace/exec', (req, res) => {
  const { command } = req.body as { command?: string };
  if (!command || typeof command !== 'string' || !command.trim() || command.length > 500) {
    res.status(400).json({ error: 'command é obrigatório (string curta)' });
    return;
  }
  if (BLOCKED_CMD.test(command)) {
    res.status(403).json({ error: 'Comando bloqueado por segurança (destrutivo demais)' });
    return;
  }
  exec(
    command,
    {
      cwd: join(process.cwd(), 'workspace'),
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      timeout: 90_000,
      maxBuffer: 512 * 1024,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    },
    (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.slice(0, 60_000);
      res.json({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        output,
        timedOut: !!(err as any)?.killed,
      });
    }
  );
});

/* ---------- estado compartilhado (sessão do PC = sessão do celular) ----------
   Chaves permitidas: sessions, settings, customPersonas, hiddenAgents.
   O frontend espelha o localStorage aqui e lê na inicialização. */

const STATE_KEYS = new Set(['sessions', 'settings', 'customPersonas', 'hiddenAgents']);

app.get('/api/state/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!STATE_KEYS.has(key)) {
      res.status(400).json({ error: 'Chave inválida' });
      return;
    }
    const r = await pool.query('SELECT value FROM app_state WHERE key = $1', [key]);
    if (r.rows.length === 0) {
      res.json({ value: null });
      return;
    }
    res.json({ value: r.rows[0].value });
  } catch (error: any) {
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

app.put('/api/state/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!STATE_KEYS.has(key)) {
      res.status(400).json({ error: 'Chave inválida' });
      return;
    }
    const { value } = req.body as { value?: unknown };
    if (value === undefined) {
      res.status(400).json({ error: 'value é obrigatório' });
      return;
    }
    await pool.query(
      `INSERT INTO app_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (error: any) {
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

app.delete('/api/state', async (_req, res) => {
  try {
    await pool.query('DELETE FROM app_state');
    res.json({ ok: true });
  } catch (error: any) {
    res.status(503).json({ error: 'Banco indisponível', details: error.message });
  }
});

app.get('/api/models', async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('Models error:', error);
    res.status(500).json({ error: 'Failed to fetch models', details: error.message });
  }
});

/* ---------- OpenCode Zen ---------- */

// cache em memória pra não bater na API do Zen a cada atualização da lista
let zenModelsCache: { at: number; models: string[] } | null = null;
const ZEN_CACHE_MS = 5 * 60 * 1000;

app.get('/api/zen/models', async (_req, res) => {
  try {
    if (!zenModelsCache || Date.now() - zenModelsCache.at > ZEN_CACHE_MS) {
      const ids = await listZenModels();
      zenModelsCache = { at: Date.now(), models: ids.map(id => `${ZEN_PREFIX}${id}`) };
    }
    res.json({ models: zenModelsCache.models });
  } catch (error: any) {
    console.error('Zen models error:', error);
    res.status(502).json({ error: 'Falha ao listar modelos do OpenCode Zen', details: error.message });
  }
});

/* ---------- opencode local (grátis via opencode serve da máquina) ---------- */

app.get('/api/oc/models', async (_req, res) => {
  try {
    // sobe o `opencode serve` se for a primeira vez (demora alguns segundos)
    res.json({ models: await listOcModels() });
  } catch (error: any) {
    console.error('opencode local models error:', error);
    res.status(503).json({
      error: 'Não consegui falar com o opencode local',
      details: error.message,
    });
  }
});

/* ---------- providers genéricos (OpenAI-compatible) ---------- */

app.post('/api/provider/models', async (req, res) => {
  const { id, name, baseUrl, apiKey } = req.body ?? {};
  if (typeof id !== 'string' || !id.trim() || typeof baseUrl !== 'string' || !baseUrl.trim()) {
    res.status(400).json({ error: 'id e baseUrl do provider são obrigatórios' });
    return;
  }
  try {
    const models = await listProviderModels({ id, name: name || id, baseUrl, apiKey });
    res.json({ models: models.map(m => `${id}/${m}`) });
  } catch (error: any) {
    console.error('Provider models error:', error);
    res.status(502).json({
      error: `Falha ao listar modelos de "${name || id}"`,
      details: error.message,
    });
  }
});

app.get('/{*any}', (_req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

initDb();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Network: http://<SEU-IP>:${PORT}`);
  console.log(`Ollama URL: ${OLLAMA_URL}`);
});

// Keep process alive
if (process.env.NODE_ENV === 'test' || process.argv.includes('--keep-alive')) {
  setInterval(() => {}, 1000);
}