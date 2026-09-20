import { Personality } from '../types';
import { pullSharedState, pushSharedState } from './sync';

const PERSONALITIES_CACHE: Map<string, Personality> = new Map();

export async function loadPersonality(id: string): Promise<Personality | null> {
  if (PERSONALITIES_CACHE.has(id)) {
    return PERSONALITIES_CACHE.get(id)!;
  }

  try {
    const response = await fetch(`/personalities/${id}.md`);
    if (!response.ok) return null;

    const markdown = await response.text();
    const personality = parsePersonalityMarkdown(id, markdown);
    PERSONALITIES_CACHE.set(id, personality);
    return personality;
  } catch {
    return null;
  }
}

/* ---------- agentes fixos ocultos (todos excluíveis, menos o Tux) ---------- */

const HIDDEN_KEY = 'ai-agent-hidden-agents';

export function loadHiddenAgentIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHiddenAgentIds(ids: string[]): void {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  pushSharedState('hiddenAgents', ids);
}

/** primeira carga: puxa do servidor a lista de agentes custom + ocultos (PC ↔ celular) */
let syncedOnce = false;
async function syncAgentsFromServer(): Promise<void> {
  if (syncedOnce) return;
  syncedOnce = true;
  const [customs, hidden] = await Promise.all([
    pullSharedState('customPersonas'),
    pullSharedState('hiddenAgents'),
  ]);
  if (Array.isArray(customs)) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customs));
  }
  if (Array.isArray(hidden)) {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
  }
}

export async function loadAllPersonalities(): Promise<Personality[]> {
  await syncAgentsFromServer();
  const hidden = new Set(loadHiddenAgentIds());
  const knownIds = ['luna', 'luisa', 'tux', 'linus'].filter(id => !hidden.has(id));
  const personalities: Personality[] = [];

  for (const id of knownIds) {
    const p = await loadPersonality(id);
    if (p) personalities.push(p);
  }

  // agentes criados pela aba Agentes (localStorage espelhado no servidor)
  return [...personalities, ...loadCustomPersonalities()];
}

/* ---------- personas criadas pelo usuário (localStorage) ---------- */

const CUSTOM_KEY = 'ai-agent-custom-personas';

export function loadCustomPersonalities(): Personality[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(p => p && p.id && p.name) : [];
  } catch {
    return [];
  }
}

/** Cria um agente novo com prompt montado do nome + função. */
export function saveCustomPersonality(name: string, description: string): Personality {
  const id = `custom-${Date.now().toString(36)}`;
  const desc = description.trim();
  const persona: Personality = {
    id,
    name: name.trim().slice(0, 40),
    description: desc || 'Agente criado por você.',
    appearance: '',
    personality: desc,
    systemPrompt:
      `Você é ${name.trim()}, agente da empresa de T.I. Sua função: ${desc || 'apoiar o time no que precisar'}. ` +
      `Trabalhe de verdade: quando pedirem algo da sua função (código, layout, texto, plano), ` +
      `ENTREGUE o resultado completo e pronto para uso — não só converse sobre a tarefa. ` +
      `Responda de forma objetiva e natural, sem sair do seu papel.`,
  };
  const all = loadCustomPersonalities();
  all.push(persona);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(all));
  pushSharedState('customPersonas', all);
  return persona;
}

export function deleteCustomPersonality(id: string): void {
  const rest = loadCustomPersonalities().filter(p => p.id !== id);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(rest));
  pushSharedState('customPersonas', rest);
}

/**
 * Remove um agente da equipe: customs somem da lista; fixos (luna, luisa,
 * linus) vão pra lista de ocultos. O Tux NUNCA sai — ele é o mascote fixo 🐧.
 */
export function removeAgent(id: string): boolean {
  if (id === 'tux') return false;
  PERSONALITIES_CACHE.delete(id);
  if (isCustomPersonality(id)) {
    deleteCustomPersonality(id);
    return true;
  }
  const hidden = loadHiddenAgentIds();
  if (!hidden.includes(id)) {
    saveHiddenAgentIds([...hidden, id]);
  }
  return true;
}

export function isCustomPersonality(id: string): boolean {
  return id.startsWith('custom-');
}

function parsePersonalityMarkdown(id: string, markdown: string): Personality {
  const lines = markdown.split('\n');
  let name = id;
  let description = '';
  let appearance = '';
  let personality = '';
  let systemPrompt = '';

  let currentSection = '';

  for (const line of lines) {
    if (line.startsWith('# ')) {
      name = line.replace('# ', '').trim();
    } else if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '').trim().toLowerCase();
    } else if (line.startsWith('### ')) {
      currentSection = line.replace('### ', '').trim().toLowerCase();
    } else if (line.trim() && !line.startsWith('>') && !line.startsWith('*') && !line.startsWith('-')) {
      switch (currentSection) {
        case 'informações básicas':
        case 'informacoes basicas':
          if (line.includes(':')) {
            const [key, value] = line.split(':').map(s => s.trim());
            if (key.toLowerCase().includes('nome')) name = value;
          }
          break;
        case 'personalidade':
          personality += line + '\n';
          break;
        case 'aparência':
        case 'aparencia':
          appearance += line + '\n';
          break;
        case 'system prompt para ia':
        case 'system prompt':
          systemPrompt += line + '\n';
          break;
        default:
          if (currentSection.includes('personalidade') || currentSection.includes('caracter')) {
            personality += line + '\n';
          } else if (currentSection.includes('aparência') || currentSection.includes('aparencia')) {
            appearance += line + '\n';
          } else if (currentSection.includes('system')) {
            systemPrompt += line + '\n';
          }
      }
    }
  }

  description = `${personality.trim()}\n\n${appearance.trim()}`.trim();

  if (!systemPrompt) {
    systemPrompt = `Você é ${name}. ${personality.trim().split('\n')[0]}. Responda de forma natural, curta, com personalidade.`;
  }

  return {
    id,
    name,
    description,
    appearance: appearance.trim(),
    personality: personality.trim(),
    systemPrompt: systemPrompt.trim(),
  };
}

export function getDefaultSystemPrompt(personality: Personality): string {
  return personality.systemPrompt || `Você é ${personality.name}. ${personality.personality}. Responda de forma natural e com personalidade.`;
}