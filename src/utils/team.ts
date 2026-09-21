/**
 * Modo EQUIPE 🤝: vários agentes trabalham JUNTOS na mesma tarefa,
 * entregando arquivos em workspace/ (mesmo formato do modo tarefa).
 *
 * - SEQUENCIAL: cada agente vê o que os anteriores entregaram (arquivos +
 *   resumo + trechos) e constrói em cima (ex.: backend primeiro, frontend
 *   depois, consumindo a API certa).
 * - PARALELO: todos trabalham ao mesmo tempo, cada um na sua especialidade,
 *   combinando interfaces por convenção.
 */

import { Personality } from '../types';

export interface Teammate {
  name: string;
  role: string;
}

export interface Delivery {
  name: string;
  files: string[];
  /** resumo do que a pessoa fez (sem os blocos de arquivo/comando) */
  summary: string;
}

/**
 * Remove os blocos de entrega (### arquivo: + ```...``` e ### comando:)
 * e devolve só o "resumo" textual que sobra no fim da resposta.
 */
export function stripDeliverables(text: string): string {
  return text
    .replace(/###\s*arquivo:[^\n]*\n+```[\w.+-]*\s*\n[\s\S]*?```/g, '')
    .replace(/^###\s*comando:.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Monta as mensagens da "rodada de trabalho" de um agente. */
export function buildWorkMessages(
  persona: Personality,
  teammates: Teammate[],
  task: string,
  prior: Delivery[],
  parallel: boolean
) {
  const team = teammates.map(t => `${t.name} (${t.role})`).join(', ');

  const teamRule = parallel
    ? '[MODO EQUIPE — PARALELO] Você está trabalhando EM EQUIPE e AO MESMO TEMPO nesta tarefa com: ' +
      `${team}. Cada um cuida da SUA especialidade: entregue APENAS os arquivos da sua área. ` +
      'Como você não vê o trabalho dos colegas em tempo real, use CONVENÇÕES CLARAS e documente no resumo ' +
      'o que você espera dos outros (ex.: "a API sobe em :3001 com rota GET /api/dados").'
    : '[MODO EQUIPE — SEQUENCIAL] Você está trabalhando EM EQUIPE nesta tarefa com: ' +
      `${team}. Você recebe o que os colegas JÁ ENTREGARAM antes de você: NÃO refaça o trabalho deles; ` +
      'construa EM CIMA (reutilize rotas, nomes, formatos e portas). Entregue APENAS os arquivos da SUA especialidade.';

  const system =
    `${persona.systemPrompt}\n\n` +
    `${teamRule}\n\n` +
    'FORMATO DE ENTREGA (obrigatório): para cada arquivo, use exatamente:\n' +
    '### arquivo: caminho/relativo/nome.ext\n```linguagem\n(conteúdo completo, sem resumir)\n```\n' +
    'e, se precisar instalar/rodar algo, comandos assim (um por linha):\n' +
    '### comando: npm install\n\n' +
    'Regras: caminhos relativos simples (sem ".."); código COMPLETO e pronto; no máximo 6 arquivos; ' +
    'finalmente, escreva um resumo de 1 ou 2 linhas do que VOCÊ entregou (não o dos outros).';

  let user = `TAREFA DA EQUIPE: ${task}`;

  if (!parallel && prior.length > 0) {
    user += '\n\n=== O QUE JÁ FOI ENTREGUE PELA EQUIPE ===\n';
    for (const d of prior) {
      user += `\n— ${d.name}: ${d.files.length > 0 ? `${d.files.length} arquivo(s): ${d.files.join(', ')}` : 'sem arquivos'} — ${d.summary}\n`;
    }
  }

  user += '\n\nSua parte agora (só a SUA especialidade):';

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
