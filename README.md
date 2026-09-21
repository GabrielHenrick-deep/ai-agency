# Agência

Chat web com uma **equipe de agentes de IA** — cada um com personalidade, função e visual próprios, como os funcionários de uma agência/empresa de TI. Roda localmente (Ollama) ou com providers em nuvem.

## O que é

- **Agentes com personalidade** — cada agente é definido em Markdown (`public/personalities/`) com aparência, traços, interesses e system prompt próprios. O agente padrão é o **Tux**, pinguim sysadmin filósofo do software livre.
- **Contratação de agentes** — na aba de criação você monta novos agentes do zero: nome, descrição, visual customizado e área de atuação (Desenvolvimento, QA, DevOps, Design, Dados, Segurança, Produto, Suporte).
- **Chat 1:1** com sessões de conversa separadas por agente, e **@menções** para chamar outro agente da equipe no meio do papo.
- **Escritório 3D** — os agentes ganham corpo num escritório (three.js) e participam de **reuniões** temáticas, dialogando entre si com memória da reunião anterior.
- **Modo tarefa** 🛠️ — o agente entrega trabalho de verdade: gera arquivos salvos em `workspace/` e sugere comandos prontos para rodar.
- **Modo equipe** 🤝 — vários agentes trabalham JUNTOS na mesma tarefa (ex.: um no backend, outro no frontend). Você escolhe quem participa e se trabalham **em sequência** (cada um vê o que o anterior entregou) ou **em paralelo** (todos ao mesmo tempo). Arquivos e comandos chegam como no modo tarefa.
- **Sync entre dispositivos** — sessões e configurações são persistidas num Postgres (PC ↔ celular); se o banco estiver fora, cai pro `localStorage`.

## Requisitos

- Node.js 18+
- [Ollama](https://ollama.ai) instalado e rodando (se quiser modelos locais; ex.: `ollama pull llama3.2:3b`)
- Docker (opcional) para o Postgres do sync multi-dispositivo

## Instalação

```bash
npm install

# (opcional) sobe o Postgres para o sync entre dispositivos
docker compose up -d

# Desenvolvimento (roda cliente + servidor)
npm run dev

# Ou separadamente:
npm run dev:client  # Vite na porta 5173
npm run dev:server  # Express na porta 3001

# Build para produção
npm run build
```

## Estrutura

```
├── public/
│   └── personalities/
│       └── tux.md             # Agente padrão (definido em Markdown)
├── server/
│   ├── index.ts               # Backend Express (proxy Ollama, Zen, providers, /api/state)
│   ├── db.ts                  # Postgres (sync multi-dispositivo)
│   ├── providers.ts           # Providers OpenAI-compatible
│   ├── zen.ts                 # OpenCode Zen
│   └── opencodeLocal.ts       # OpenCode local (opencode serve)
├── src/
│   ├── components/            # Chat, Sidebar, Escritório 3D, menções…
│   ├── context/               # ChatContext (estado global)
│   ├── hooks/                 # Custom hooks (@mentions)
│   ├── types/                 # TypeScript types
│   └── utils/                 # Agente, reuniões, modo tarefa, sync…
├── workspace/                 # Arquivos gerados pelos agentes no modo tarefa
└── package.json
```

## Adicionando novos agentes

**Pela interface (recomendado):** aba de criação na barra lateral — escolha a área de atuação, nome, descrição e visual.

**Por Markdown:**

1. Crie um arquivo `.md` em `public/personalities/` seguindo o formato de `tux.md`
2. Adicione o ID no array `knownIds` em `src/utils/personality.ts`
3. O agente aparece automaticamente na equipe

### Formato do Markdown do agente

```markdown
# Personalidade: Nome do Agente

## Informações Básicas
- **Nome:** ...
- **Aparência:** ...
- **Estilo:** ...

## Personalidade
- Traço 1
- Traço 2

## Interesses
- Interesse 1
- Interesse 2

## System Prompt para IA
Instruções diretas para o modelo...
```

## Configuração

As configurações são salvas no Postgres (sync) ou no `localStorage` como fallback:
- Modelo padrão e **modelo por agente**
- Temperatura e max tokens
- URL do Ollama
- Chave da API do OpenCode Zen
- Providers externos (nome, URL, chave)
- Agente ativo e histórico de conversas
- Visuais customizados dos bonecos do escritório (estilo chibi; fedora ligável/desligável por boneco — aba Bonecos)

## Providers em nuvem (qualquer API OpenAI-compatible)

Em **Ajustes › Providers** você adiciona qualquer API compatível com o formato
OpenAI (`chat/completions`): OpenRouter, Groq, Together, Mistral, LM Studio etc.
Os modelos aparecem com o prefixo do provider (ex.: `openrouter/<modelo>`) e
podem ser escolhidos globalmente ou por agente.

O **OpenRouter** já vem pré-configurado: crie uma chave gratuita em
[openrouter.ai/keys](https://openrouter.ai/keys), cole no card e clique em
⟳ atualizar. Modelos com sufixo `:free` (ex.: `deepseek/deepseek-r1-0528:free`)
não cobram nada, com limite de ~50 requisições/dia.

## OpenCode local (prefixo `oc/`)

Se o OpenCode está instalado na máquina, o app sobe um `opencode serve`
próprio (porta 4199, permissões travadas — só conversa) e reaproveita as
credenciais dos providers que você já conectou nele. Os modelos aparecem
como `oc/<provider>/<modelo>` no grupo **OpenCode local**, sem precisar
configurar nada.

Observações:
- Os modelos **gratuitos do Zen** (`big-pickle`, `*-free`) não funcionam por
  aqui — o bloqueio é feito no servidor do Zen para qualquer uso via API —,
  então são omitidos da lista.
- A lista vem do catálogo do opencode; modelos descontinuados no provider
  original podem aparecer e falhar com `410 Gone` ao chamar.

## Modelos da nuvem (OpenCode Zen)

Além dos modelos locais do Ollama, os agentes podem usar os modelos do
[OpenCode Zen](https://opencode.ai/zen) (Claude, GPT, Gemini, Kimi, GLM,
DeepSeek etc.). Observação: os modelos **gratuitos** do Zen (`big-pickle`,
`*-free`) só podem ser usados de dentro do app do OpenCode, então são
omitidos da lista.

1. Crie uma chave em [opencode.ai/zen](https://opencode.ai/zen)
2. Cole em **Ajustes › OpenCode Zen (API key)**
3. Clique em **⟳ atualizar** na lista de modelos
4. Escolha um modelo do grupo **OpenCode Zen** — global ou por agente
   (aba **Agentes**, seletor abaixo de cada card)

Modelos Zen usam o prefixo `opencode/` (ex.: `opencode/kimi-k3`) e valem para o
chat e para as reuniões do escritório 3D. Alternativamente à chave na UI, é
possível exportar `OPENCODE_API_KEY` no servidor.

## Deploy

```bash
npm run build
npm start
```

O servidor Express serve os arquivos estáticos do build e faz proxy para o Ollama.

## Licença

MIT
