import type { CharacterVisual } from '../utils/visuals';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface Personality {
  id: string;
  name: string;
  description: string;
  appearance: string;
  personality: string;
  systemPrompt: string;
  avatar?: string;
}

export interface ChatSession {
  id: string;
  personalityId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AppSettings {
  ollamaUrl: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  availableModels: string[];
  /** modelo por persona (id -> model). Ausente = usa defaultModel. */
  personalityModels: Record<string, string>;
  /** chave da API do OpenCode Zen (opencode.ai/zen) — fica só no navegador. */
  zenApiKey: string;
  /** providers externos OpenAI-compatible (ex.: OpenRouter, Groq, LM Studio). */
  providers: ProviderConfig[];
  /** visual customizado por persona no escritório 3D (id -> visual). */
  charVisuals: Record<string, CharacterVisual>;
}

/** Provider de nuvem genérico (API compatível com OpenAI chat/completions). */
export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface OllamaRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}