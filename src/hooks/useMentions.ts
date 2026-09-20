import { useMemo, useState } from 'react';
import { Personality } from '../types';
import { applyMention, findMentionQuery, matchAgents } from '../utils/mention';

interface MentionState {
  start: number;
  query: string;
  active: number;
}

/** Lógica do autocomplete de @menções (usada nos dois composers). */
export function useMentions(agents: Personality[]) {
  const [m, setM] = useState<MentionState | null>(null);

  const matches = useMemo(() => (m ? matchAgents(agents, m.query) : []), [agents, m]);
  const active = m ? Math.min(m.active, Math.max(matches.length - 1, 0)) : 0;

  /** Chamar no onChange com texto + posição do cursor. */
  function update(text: string, caret: number) {
    const found = findMentionQuery(text, caret);
    if (!found) {
      if (m) setM(null);
      return;
    }
    setM(prev => ({
      start: found.start,
      query: found.query,
      active: prev && prev.start === found.start ? prev.active : 0,
    }));
  }

  function move(dir: 1 | -1) {
    const n = matches.length;
    if (!m || n === 0) return;
    setM({ ...m, active: (m.active + dir + n) % n });
  }

  /** Conclui com o item `index ?? active`. Retorna texto novo + caret. */
  function commit(text: string, index?: number): { text: string; caret: number } | null {
    if (!m || matches.length === 0) return null;
    const agent = matches[index ?? active] ?? matches[0];
    setM(null);
    return applyMention(text, m.start, m.query, agent.name);
  }

  function close() {
    setM(null);
  }

  return {
    mention: m ? { start: m.start, query: m.query, active, matches } : null,
    update,
    move,
    commit,
    close,
  };
}
