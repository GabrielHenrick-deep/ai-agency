import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { Message, Personality, ChatSession, AppSettings } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { loadAllPersonalities, loadPersonality, getDefaultSystemPrompt } from '../utils/personality';
import { isCloudModel } from '../utils/providers';
import { pullSharedState, pushSharedState } from '../utils/sync';

interface ChatState {
  personalities: Personality[];
  currentPersonality: Personality | null;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
}

type ChatAction =
  | { type: 'SET_PERSONALITIES'; payload: Personality[] }
  | { type: 'SET_CURRENT_PERSONALITY'; payload: Personality }
  | { type: 'SET_SESSIONS'; payload: ChatSession[] }
  | { type: 'SET_CURRENT_SESSION'; payload: ChatSession | null }
  | { type: 'ADD_MESSAGE'; payload: { sessionId: string; message: Message } }
  | { type: 'UPDATE_MESSAGE'; payload: { sessionId: string; messageId: string; content: string } }
  | { type: 'CREATE_SESSION'; payload: { personalityId: string } }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'SET_SETTINGS'; payload: Partial<AppSettings> }
  | { type: 'SET_AVAILABLE_MODELS'; payload: string[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const STORAGE_KEYS = {
  SESSIONS: 'ai-agent-sessions',
  SETTINGS: 'ai-agent-settings',
  CURRENT_PERSONALITY: 'ai-agent-current-personality',
  CURRENT_SESSION: 'ai-agent-current-session',
};

const DEFAULT_SETTINGS: AppSettings = {
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'jaahas/qwen3.5-uncensored:4b',
  temperature: 0.8,
  maxTokens: 4096,
  systemPrompt: '',
  availableModels: ['jaahas/qwen3.5-uncensored:4b', 'llama3.2:3b', 'llama3.2:1b', 'mistral:7b', 'gemma2:2b', 'phi3:3.8b'],
  personalityModels: {},
  zenApiKey: '',
  providers: [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
    },
  ],
  charVisuals: {},
};

/** Modelo efetivo de uma persona (específico ou o padrão global). */
export function getModelFor(settings: AppSettings, personalityId: string | undefined | null): string {
  if (personalityId && settings.personalityModels[personalityId]) {
    return settings.personalityModels[personalityId];
  }
  return settings.defaultModel;
}

const initialState: ChatState = {
  personalities: [],
  currentPersonality: null,
  sessions: [],
  currentSession: null,
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  error: null,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_PERSONALITIES':
      return { ...state, personalities: action.payload, isLoading: false };

    case 'SET_CURRENT_PERSONALITY': {
      const newState = { ...state, currentPersonality: action.payload };
      try {
        localStorage.setItem(STORAGE_KEYS.CURRENT_PERSONALITY, action.payload.id);
      } catch {}
      return newState;
    }

    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload };

    case 'SET_CURRENT_SESSION': {
      const newState = { ...state, currentSession: action.payload };
      try {
        if (action.payload) {
          localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION, action.payload.id);
        } else {
          localStorage.removeItem(STORAGE_KEYS.CURRENT_SESSION);
        }
      } catch {}
      return newState;
    }

    case 'ADD_MESSAGE': {
      const sessions = state.sessions.map(session => {
        if (session.id === action.payload.sessionId) {
          const updated = {
            ...session,
            messages: [...session.messages, action.payload.message],
            updatedAt: new Date(),
          };
          try {
            localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(
              state.sessions.map(s => s.id === session.id ? updated : s)
            ));
          } catch {}
          return updated;
        }
        return session;
      });
      return {
        ...state,
        sessions,
        currentSession: state.currentSession?.id === action.payload.sessionId
          ? sessions.find(s => s.id === action.payload.sessionId) || null
          : state.currentSession,
      };
    }

    case 'UPDATE_MESSAGE': {
      const sessions = state.sessions.map(session => {
        if (session.id === action.payload.sessionId) {
          const updated = {
            ...session,
            messages: session.messages.map(msg =>
              msg.id === action.payload.messageId ? { ...msg, content: action.payload.content } : msg
            ),
            updatedAt: new Date(),
          };
          try {
            localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(
              state.sessions.map(s => s.id === session.id ? updated : s)
            ));
          } catch {}
          return updated;
        }
        return session;
      });
      return {
        ...state,
        sessions,
        currentSession: state.currentSession?.id === action.payload.sessionId
          ? sessions.find(s => s.id === action.payload.sessionId) || null
          : state.currentSession,
      };
    }

    case 'CREATE_SESSION': {
      const personality = state.personalities.find(p => p.id === action.payload.personalityId);
      if (!personality) return state;

      const newSession: ChatSession = {
        id: uuidv4(),
        personalityId: action.payload.personalityId,
        messages: [
          {
            id: uuidv4(),
            role: 'system',
            content: getDefaultSystemPrompt(personality),
            timestamp: new Date(),
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const sessions = [...state.sessions, newSession];
      try {
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
      } catch {}
      return { ...state, sessions, currentSession: newSession };
    }

    case 'DELETE_SESSION': {
      const sessions = state.sessions.filter(s => s.id !== action.payload);
      try {
        localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
      } catch {}
      return {
        ...state,
        sessions,
        currentSession: state.currentSession?.id === action.payload ? null : state.currentSession,
      };
    }

    case 'SET_SETTINGS': {
      const settings = { ...state.settings, ...action.payload };
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      } catch {}
      return { ...state, settings };
    }

    case 'SET_AVAILABLE_MODELS': {
      const settings = { ...state.settings, availableModels: action.payload };
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      } catch {}
      return { ...state, settings };
    }

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };

    default:
      return state;
  }
}

const ChatContext = createContext<{
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  sendMessage: (content: string) => Promise<void>;
  streamMessage: (content: string, extraSystem?: string) => Promise<string>;
  fetchModels: () => Promise<void>;
} | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  useEffect(() => {
    async function init() {
      dispatch({ type: 'SET_LOADING', payload: true });

      try {
        // estado compartilhado: servidor (Postgres) ganha do localStorage quando existe,
        // assim a sessão do PC é a MESMA do celular
        const [remoteSettings, remoteSessions] = await Promise.all([
          pullSharedState('settings'),
          pullSharedState('sessions'),
        ]);
        if (remoteSettings && typeof remoteSettings === 'object') {
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(remoteSettings));
        }
        if (Array.isArray(remoteSessions)) {
          localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(remoteSessions));
        }

        const [personalities, savedSettings, savedPersonalityId, savedSessionId] = await Promise.all([
          loadAllPersonalities(),
          Promise.resolve(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || 'null')),
          Promise.resolve(localStorage.getItem(STORAGE_KEYS.CURRENT_PERSONALITY)),
          Promise.resolve(localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION)),
        ]);

        dispatch({ type: 'SET_PERSONALITIES', payload: personalities });

        if (savedSettings) {
          dispatch({ type: 'SET_SETTINGS', payload: savedSettings });
        }

        if (savedPersonalityId) {
          const personality = personalities.find(p => p.id === savedPersonalityId);
          if (personality) {
            dispatch({ type: 'SET_CURRENT_PERSONALITY', payload: personality });
          }
        } else if (personalities.length > 0) {
          dispatch({ type: 'SET_CURRENT_PERSONALITY', payload: personalities[0] });
        }

        const savedSessions = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '[]');
        const sessions = savedSessions.map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
          messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
        }));
        dispatch({ type: 'SET_SESSIONS', payload: sessions });

        if (savedSessionId) {
          const session = sessions.find((s: ChatSession) => s.id === savedSessionId);
          if (session) {
            dispatch({ type: 'SET_CURRENT_SESSION', payload: session });
          }
        }
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: 'Erro ao carregar dados' });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }

    init();
  }, []);

  // espelha sessões e ajustes no servidor (debounce p/ não martelar o banco)
  // → PC e celular compartilham a MESMA sessão
  useEffect(() => {
    if (state.isLoading) return;
    const t = setTimeout(() => pushSharedState('sessions', state.sessions), 800);
    return () => clearTimeout(t);
  }, [state.sessions, state.isLoading]);

  useEffect(() => {
    if (state.isLoading) return;
    const t = setTimeout(() => pushSharedState('settings', state.settings), 800);
    return () => clearTimeout(t);
  }, [state.settings, state.isLoading]);

  const sendMessage = async (content: string) => {
    if (!state.currentSession || !state.currentPersonality || !state.settings) return;

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    dispatch({ type: 'ADD_MESSAGE', payload: { sessionId: state.currentSession.id, message: userMessage } });

    const messages = [
      { role: 'system', content: getDefaultSystemPrompt(state.currentPersonality) },
      ...state.currentSession.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];

    const model = getModelFor(state.settings, state.currentPersonality?.id);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: state.settings.temperature,
            num_predict: state.settings.maxTokens,
          },
          zenApiKey: state.settings.zenApiKey,
          providers: state.settings.providers,
        }),
      });

      const data = await response.json();
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: data.message?.content || 'Erro ao gerar resposta',
        timestamp: new Date(),
      };

      dispatch({ type: 'ADD_MESSAGE', payload: { sessionId: state.currentSession.id, message: assistantMessage } });
    } catch (error) {
      const errorMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: isCloudModel(model, state.settings.providers)
          ? 'Erro ao chamar o modelo de nuvem. Confira a chave do provider em Ajustes.'
          : 'Erro ao conectar com o modelo. Verifique se o Ollama está rodando.',
        timestamp: new Date(),
      };
      dispatch({ type: 'ADD_MESSAGE', payload: { sessionId: state.currentSession.id, message: errorMessage } });
    }
  };

  const streamMessage = async (content: string, extraSystem?: string): Promise<string> => {
    if (!state.currentSession || !state.currentPersonality || !state.settings) return '';

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    dispatch({ type: 'ADD_MESSAGE', payload: { sessionId: state.currentSession.id, message: userMessage } });

    const assistantMessageId = uuidv4();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    dispatch({ type: 'ADD_MESSAGE', payload: { sessionId: state.currentSession.id, message: assistantMessage } });

    const baseSystem = getDefaultSystemPrompt(state.currentPersonality);
    const messages = [
      { role: 'system', content: extraSystem ? `${baseSystem}\n\n${extraSystem}` : baseSystem },
      ...state.currentSession.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];

    const model = getModelFor(state.settings, state.currentPersonality?.id);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          options: {
            temperature: state.settings.temperature,
            num_predict: state.settings.maxTokens,
          },
          zenApiKey: state.settings.zenApiKey,
          providers: state.settings.providers,
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.message?.content) {
                  fullContent += parsed.message.content;
                  dispatch({
                    type: 'UPDATE_MESSAGE',
                    payload: { sessionId: state.currentSession!.id, messageId: assistantMessageId, content: fullContent },
                  });
                }
              } catch {}
            }
          }
        }
      }
      return fullContent;
    } catch (error) {
      dispatch({
        type: 'UPDATE_MESSAGE',
        payload: {
          sessionId: state.currentSession.id,
          messageId: assistantMessageId,
          content: isCloudModel(model, state.settings.providers)
            ? 'Erro ao chamar o modelo de nuvem. Confira a chave do provider em Ajustes.'
            : 'Erro ao conectar com o modelo. Verifique se o Ollama está rodando.',
        },
      });
      return '';
    }
  };

  const fetchModels = async () => {
    // usa o proxy do backend (/api/models) para funcionar também no celular,
    // onde "localhost" do navegador não é o PC
    let ollamaModels: string[] = [];
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        ollamaModels = data.models?.map((m: any) => m.name) || [];
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }

    // modelos do OpenCode Zen (endpoint público; a chave só é exigida na hora de chamar)
    let zenModels: string[] = [];
    try {
      const response = await fetch('/api/zen/models');
      if (response.ok) {
        zenModels = (await response.json()).models ?? [];
      }
    } catch (error) {
      console.error('Failed to fetch Zen models:', error);
    }

    // opencode local: modelos grátis via `opencode serve` da máquina
    // (o backend sobe a instância na 1ª chamada — pode demorar alguns segundos)
    let ocModels: string[] = [];
    try {
      const response = await fetch('/api/oc/models');
      if (response.ok) {
        ocModels = (await response.json()).models ?? [];
      }
    } catch (error) {
      console.error('Failed to fetch opencode-local models:', error);
    }

    // providers genéricos configurados (OpenRouter, Groq, etc.)
    let providerModels: string[] = [];
    for (const p of state.settings.providers) {
      if (!p.id || !p.baseUrl) continue;
      try {
        const response = await fetch('/api/provider/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey }),
        });
        if (response.ok) {
          providerModels = providerModels.concat((await response.json()).models ?? []);
        } else {
          console.error(`Failed to fetch models of ${p.name}:`, await response.text());
        }
      } catch (error) {
        console.error(`Failed to fetch models of ${p.name}:`, error);
      }
    }

    const models = [...ollamaModels, ...zenModels, ...ocModels, ...providerModels];
    if (models.length > 0) {
      dispatch({ type: 'SET_AVAILABLE_MODELS', payload: models });
    }
  };

  return (
    <ChatContext.Provider value={{ state, dispatch, sendMessage, streamMessage, fetchModels }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}