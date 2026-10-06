/**
 * Modo tarefa: o agente entrega TRABALHO DE VERDADE.
 * Quando o 🛠️ está ligado, a resposta dele pode conter arquivos neste formato:
 *
 * ### projeto: nome-do-projeto
 * ### arquivo: caminho/relativo/nome.ext
 * ```linguagem
 * conteúdo completo
 * ```
 *
 * Aqui a gente extrai esses arquivos e manda o backend salvar na pasta
 * Documentos\<projeto>\ do computador — e os comandos rodam dentro dela.
 */

export interface TaskFile {
  path: string;
  content: string;
}

/** Instrução anexada ao system prompt do agente enquanto o modo tarefa está ligado. */
export const TASK_INSTRUCTION =
  'MODO TAREFA ATIVO: execute o pedido DE VERDADE, dentro da sua função — não explique, FAÇA. ' +
  'Antes de tudo, declare a pasta do projeto em UMA linha (minúsculas, palavras com hífen, sem espaços):\n\n' +
  '### projeto: nome-do-projeto\n\n' +
  'Os arquivos serão salvos na pasta Documentos dessa pasta de projeto, no computador do usuário, e os comandos rodarão dentro dela. ' +
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
  'Os comandos serão executados num terminal separado pelo usuário, já na pasta do projeto. ' +
  'Depois de arquivos e comandos, escreva um resumo de 1 ou 2 linhas do que foi entregue.';

/** Slug de pasta: minúsculas, sem acento, só letras/números/hífen. Ex.: "Site da Vovó!" → "site-da-vovo" */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos combinantes (U+0300–U+036F)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/** Extrai o nome do projeto da linha "### projeto: ..." (se o agente declarou). */
export function extractProject(text: string): string | null {
  const m = /###\s*projeto:\s*([^\n]+)/.exec(text);
  if (!m) return null;
  return slugify(m[1].trim().replace(/^[`'"]+|[`'"]+$/g, '')) || null;
}

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

/** Resultado do salvamento: caminhos gravados + a pasta real do projeto. */
export interface DeliverResult {
  saved: string[];
  /** slug final da pasta (sanitizado pelo backend) */
  project: string;
  /** caminho completo da pasta no computador (ex.: C:\Users\...\Documents\meu-app) */
  dir: string;
}

/**
 * Manda os arquivos pro backend salvar em Documentos\<projeto>\.
 * Retorna o resultado com a pasta real usada, ou null se falhou.
 */
export async function saveProjectFiles(files: TaskFile[], project: string): Promise<DeliverResult | null> {
  try {
    const res = await fetch('/api/deliveries/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, project }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.saved)) return null;
    return { saved: data.saved, project: data.project ?? project, dir: data.dir ?? '' };
  } catch {
    return null;
  }
}

export interface ExecResult {
  code: number;
  output: string;
  timedOut: boolean;
}

/** Roda um comando dentro da pasta do projeto em Documentos (backend executa com timeout). */
export async function runCommand(command: string, project?: string): Promise<ExecResult> {
  try {
    const res = await fetch('/api/deliveries/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, project }),
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
