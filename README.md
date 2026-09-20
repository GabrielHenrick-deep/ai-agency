# AI Agent Chat - Luna

Chat web com agentes de IA que têm personalidade própria. Roda localmente com Ollama.

## Personalidade Atual: Luna

- **Ruiva, magra, 23 anos**
- **Introvertida** - poucas amizades, mas profundas
- **Fã de Taylor Swift** - conhece todas as eras, easter eggs, letras
- **Criativa** - escreve poemas, desenha, fotografia analógica
- **Sarcasmo seco** - humor sutil, referências musicais
- **Trabalha em livraria indie**

## Requisitos

- Node.js 18+
- [Ollama](https://ollama.ai) instalado e rodando
- Modelo baixado (ex: `ollama pull llama3.2:3b`)

## Instalação

```bash
# Instalar dependências
npm install

# Desenvolvimento (roda cliente + servidor)
npm run dev

# Ou separadamente:
npm run dev:client  # Vite na porta 5173
npm run dev:server  # Express na porta 3001

# Build para produção
npm run build

# Preview do build
npm run preview
```

## Estrutura

```
├── public/
│   └── personalities/
│       └── luna.md          # Personalidade em markdown
├── server/
│   └── index.ts             # Backend Express (proxy Ollama + API)
├── src/
│   ├── components/          # React components
│   ├── context/             # ChatContext (estado global)
│   ├── hooks/               # Custom hooks
│   ├── types/               # TypeScript types
│   └── utils/               # Utilitários (parser de personalidade)
├── index.html
└── package.json
```

## Adicionando Novas Personalidades

1. Crie um arquivo `.md` em `public/personalities/` seguindo o formato de `luna.md`
2. Adicione o ID no array `knownIds` em `src/utils/personality.ts`
3. A personalidade aparecerá automaticamente no painel lateral

## Formato do Markdown da Personalidade

```markdown
# Nome da Personalidade

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

As configurações são salvas no `localStorage`:
- Modelo Ollama
- Temperatura
- Max tokens
- URL do Ollama
- Chave da API do OpenCode Zen
- Providers externos (nome, URL, chave)
- Personalidade ativa
- Histórico de conversas

## Providers em nuvem (qualquer API OpenAI-compatible)

Em **Ajustes › Providers** você adiciona qualquer API compatível com o formato
OpenAI (`chat/completions`): OpenRouter, Groq, Together, Mistral, LM Studio etc.
Os modelos aparecem com o prefixo do provider (ex.: `openrouter/<modelo>`) e
podem ser escolhidos globalmente ou por persona.

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
4. Escolha um modelo do grupo **OpenCode Zen** — global ou por persona
   (aba **Personas**, seletor abaixo de cada card)

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