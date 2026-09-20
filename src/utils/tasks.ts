/**
 * Modo tarefa: o agente entrega TRABALHO DE VERDADE.
 * Quando o 🛠️ está ligado, a resposta dele pode conter arquivos neste formato:
 *
 * ### arquivo: caminho/relativo/nome.ext
 * ```linguagem
 * conteúdo completo
 * ```
 *
 * Aqui a gente extrai esses arquivos e manda o backend salvar em workspace/.
 */

export interface TaskFile {
  path: string;
  content: string;
}

/** Instrução anexada ao system prompt do agente enquanto o modo tarefa está ligado. */
export const TASK_INSTRUCTION =
  'MODO TAREFA ATIVO: execute o pedido DE VERDADE, dentro da sua função — não explique, FAÇA. ' +
  'Se a tarefa envolver criar arquivos (código, página, script, documento, dados...), entregue CADA arquivo exatamente neste formato:\n\n' +
  '### arquivo: caminho/relativo/nome.ext\n' +
  '```linguagem\n' +
  '(conteúdo completo do arquivo, sem resumir e sem cortar)\n' +
  '```\n\n' +
  'Se for preciso rodar algo para instalar, montar, testar ou validar o trabalho, liste CADA comando assim (um por linha, sem explicação no meio):\n\n' +
  '### comando: npm install\n' +
  '### comando: npm run build\n\n' +
  'Regras: caminhos relativos e simples (sem "..", sem "/" inicial); código COMPLETO e pronto para rodar; ' +
  'comandos curtos, sem interação (use flags tipo -y/--yes); no máximo 8 comandos. ' +
  'Os comandos serão executados num terminal separado pelo usuário. ' +
  'Depois de arquivos e comandos, escreva um resumo de 1 ou 2 linhas do que foi entregue.';

/** Extrai os blocos "### arquivo: ..." + ```código``` da resposta do agente. */
export function extractFiles(text: string): TaskFile[] {
  const files: TaskFile[] = [];
  const re = /###\s*arquivo:\s*([^\n]+?)[ \t]*\n+```[\w.+-]*\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && files.length < 30) {
    const path = m[1].trim().replace(/^[`'"]+|[`'"]+$/g, '');
    const content = m[2].replace(/\s+$/, '') + '\n';
    if (path && content.trim()) files.push({ path, content });
  }
  return files;
}

/** Extrai os "### comando: ..." da resposta do agente (um por linha). */
export function extractCommands(text: string): string[] {
  const cmds: string[] = [];
  const re = /###\s*comando:\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && cmds.length < 8) {
    const cmd = m[1].trim().replace(/^[`'"]+|[`'"]+$/g, '');
    if (cmd) cmds.push(cmd);
  }
  return cmds;
}

/** Manda os arquivos pro backend salvar em workspace/. Retorna os caminhos salvos. */
export async function saveFilesToWorkspace(files: TaskFile[]): Promise<string[]> {
  try {
    const res = await fetch('/api/workspace/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.saved) ? data.saved : [];
  } catch {
    return [];
  }
}

export interface ExecResult {
  code: number;
  output: string;
  timedOut: boolean;
}

/** Roda um comando no terminal do workspace (backend executa com timeout). */
export async function runCommand(command: string): Promise<ExecResult> {
  try {
    const res = await fetch('/api/workspace/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { code: -1, output: data.error ?? `HTTP ${res.status}`, timedOut: false };
    }
    return {
      code: typeof data.code === 'number' ? data.code : -1,
      output: data.output ?? '',
      timedOut: !!data.timedOut,
    };
  } catch (e) {
    return { code: -1, output: `Falha de rede: ${(e as Error)?.message ?? 'erro'}`, timedOut: false };
  }
}
