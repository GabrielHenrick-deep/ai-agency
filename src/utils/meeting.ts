import { Personality, ProviderConfig } from '../types';

export interface TurnHistory {
  name: string;
  text: string;
}

export interface TurnOptions {
  temperature: number;
  num_predict: number;
}

/** Monta as mensagens para a vez de um agente na reunião. */
export function buildTurnMessages(
  persona: Personality,
  peers: string[],
  topic: string,
  history: TurnHistory[],
  past?: string
) {
  const memory = past
    ? `\n\n[MEMÓRIA DA ÚLTIMA REUNIÃO]\n${past}\nSe alguém perguntar sobre a última reunião, use essas informações para responder com precisão (quem disse o quê).`
    : '';
  const system =
    `${persona.systemPrompt}\n\n` +
    `[REUNIÃO] Você está numa reunião descontraída no escritório com seus colegas: ${peers.join(', ')}. ` +
    `Responda de forma CURTA (2 a 4 frases), com sua personalidade, reagindo ao tema e ao que os colegas já disseram. ` +
    `Dialogue de verdade: concorde, discorde, complemente ou provoque — sem monólogo e sem repetir falas anteriores. É a sua vez de falar.` +
    memory;

  const convo = history.map(h => `${h.name} disse: ${h.text}`).join('\n\n');
  const user = history.length === 0
    ? `Tema da reunião: ${topic}\n\nAbra a reunião com sua opinião:`
    : `Tema da reunião: ${topic}\n\nO que já foi dito:\n${convo}\n\nSua vez de falar:`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export interface PastTurn {
  agentId: string;
  agentName: string;
  text: string;
}

export interface PastMeeting {
  id: number;
  topic: string;
  created_at: string;
  turns: PastTurn[];
}

/** Salva a ata no Postgres (via backend). Falha silenciosa se o banco estiver fora. */
export async function saveMeeting(
  topic: string,
  turns: { agentId: string; name: string; text: string }[]
): Promise<number | null> {
  try {
    const res = await fetch('/api/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        turns: turns.map(t => ({ agentId: t.agentId, agentName: t.name, text: t.text })),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.id === 'number' ? data.id : null;
  } catch {
    return null;
  }
}

/** Busca a última ata salva (ou null se não houver / banco fora). */
export async function fetchLastMeeting(): Promise<PastMeeting | null> {
  try {
    const res = await fetch('/api/meetings/last');
    if (!res.ok) return null;
    const data = await res.json();
    return data.meeting ?? null;
  } catch {
    return null;
  }
}

export interface MeetingSummary {
  id: number;
  topic: string;
  created_at: string;
  turns: number;
}

/** Lista as reuniões salvas (mais recentes primeiro). Falha silenciosa. */
export async function fetchMeetings(limit = 15): Promise<MeetingSummary[]> {
  try {
    const res = await fetch(`/api/meetings?limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.meetings) ? data.meetings : [];
  } catch {
    return [];
  }
}

/** Busca uma ata completa pelo id (ou null se não achar / banco fora). */
export async function fetchMeeting(id: number): Promise<PastMeeting | null> {
  try {
    const res = await fetch(`/api/meetings/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.meeting ?? null;
  } catch {
    return null;
  }
}

/** Resume a ata passada num texto curto pra injetar no contexto. */
export function formatPastMeeting(pm: PastMeeting): string {
  const date = new Date(pm.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const turns = pm.turns
    .map(t => `- ${t.agentName}: ${t.text.slice(0, 350)}`)
    .join('\n');
  return `Última reunião (${date}, tema: "${pm.topic}"):\n${turns}`;
}

/** Pede um turno ao backend (reusa o proxy /api/chat). */
export async function fetchTurn(
  model: string,
  messages: { role: string; content: string }[],
  options: TurnOptions,
  signal?: AbortSignal,
  cloud?: { zenApiKey?: string; providers?: ProviderConfig[] }
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options,
      zenApiKey: cloud?.zenApiKey,
      providers: cloud?.providers,
    }),
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        detail = j.details || j.error || text;
      } catch {
        detail = text;
      }
    } catch {
      /* corpo ilegível */
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
  }
  const data = await res.json();
  return (data.message?.content ?? '').trim();
}
