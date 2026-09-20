import { Personality } from '../types';

/** minúsculo sem acento, pra "@luisa" achar "Luísa". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Acha um "@token" imediatamente antes do cursor. Retorna posição do @ + query. */
export function findMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/@([A-Za-zÀ-ÿ0-9_-]*)$/);
  if (!m) return null;
  // "@" sozinho no meio de e-mail (a@b) não conta: exige início, espaço ou quebra antes
  const at = before.length - m[0].length;
  const prev = at > 0 ? before[at - 1] : ' ';
  if (prev !== ' ' && prev !== '\n' && prev !== '\t' && prev !== '(') return null;
  return { start: at, query: m[1] };
}

/** Filtra agentes pela query (nome ou id). Query vazia = todos. */
export function matchAgents(agents: Personality[], query: string): Personality[] {
  const q = normalize(query);
  const list = q === ''
    ? [...agents]
    : agents.filter(a => normalize(a.name).includes(q) || normalize(a.id).includes(q));
  return list.sort((a, b) => {
    const an = normalize(a.name), bn = normalize(b.name);
    const as = an.startsWith(q) ? 0 : 1;
    const bs = bn.startsWith(q) ? 0 : 1;
    return as - bs;
  });
}

/** Extrai ids de agentes mencionados (@nome) na ordem em que aparecem, sem repetir. */
export function parseMentions(text: string, agents: Personality[]): string[] {
  const out: string[] = [];
  const re = /@([A-Za-zÀ-ÿ0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = normalize(m[1]);
    if (tok.length < 2) continue;
    const hit = agents.find(a =>
      normalize(a.name) === tok ||
      normalize(a.id) === tok ||
      normalize(a.name).startsWith(tok)
    );
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

/** Substitui "@query" por "@Nome " e devolve o caret novo. */
export function applyMention(text: string, start: number, query: string, name: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(start + 1 + query.length);
  const insert = `@${name} `;
  return { text: before + insert + after, caret: before.length + insert.length };
}
