import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getModelFor, useChat } from '../context/ChatContext';
import { avatarEmoji, avatarGradient } from '../utils/avatar';
import { useMentions } from '../hooks/useMentions';
import { MentionPopup } from './MentionPopup';
import './ChatInterface.css';

const ThinkingOrb = lazy(() => import('./ThinkingOrb').then(m => ({ default: m.ThinkingOrb })));

function OrbFallback() {
  return (
    <div className="msg-body">
      <div className="bubble typing"><span /><span /><span /></div>
    </div>
  );
}

function renderInline(text: string): string {
  let out = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  out = out.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^[-*] /.test(t)) {
      if (!inList) { html += '<ul class="md-list">'; inList = true; }
      html += `<li>${renderInline(t.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (t === '') html += '<div class="md-gap"></div>';
      else html += `<p>${renderInline(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

const SUGGESTIONS = [
  'Oi! Como você tá hoje?',
  'Me conta algo sobre você',
  'O que você gosta de fazer?',
  'Me dá um conselho',
];

export function ChatInterface({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { state, dispatch, streamMessage } = useChat();
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentions(state.personalities);

  const persona = state.currentPersonality;
  const session = state.currentSession;
  const messages = useMemo(
    () => session?.messages.filter(m => m.role !== 'system') ?? [],
    [session]
  );

  // auto-cria sessão se tem persona mas não tem sessão
  useEffect(() => {
    if (persona && !session) {
      dispatch({ type: 'CREATE_SESSION', payload: { personalityId: persona.id } });
    }
  }, [persona, session, dispatch]);

  // scroll suave só se já está perto do fim
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, session?.messages.map(m => m.content).join('').length]);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = input.trim();
    if (!content || !session || isStreaming) return;
    setInput('');
    requestAnimationFrame(autoResize);
    setIsStreaming(true);
    try {
      await streamMessage(content);
    } finally {
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  }, [input, session, isStreaming, streamMessage, autoResize]);

  const completeMention = useCallback((index?: number) => {
    const r = mentions.commit(input, index);
    if (!r) return false;
    setInput(r.text);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(r.caret, r.caret);
      }
      autoResize();
    });
    return true;
  }, [mentions, input, autoResize]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    mentions.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const pop = mentions.mention;
    if (pop && pop.matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentions.move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mentions.move(-1); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); completeMention(); return; }
    }
    if (e.key === 'Escape' && pop) { mentions.close(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const copyMsg = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* clipboard indisponível */ }
  };

  if (!persona) {
    return (
      <div className="chat-shell">
        <div className="welcome">
          <div className="welcome-orb">✦</div>
          <h1>Escolha um agente</h1>
          <p>Toque no menu para ver os agentes da equipe e suas funções.</p>
          <button className="primary-btn" onClick={onOpenMenu}>Abrir agentes</button>
        </div>
      </div>
    );
  }

  const empty = messages.length === 0;

  return (
    <div className="chat-shell">
      <main ref={scrollRef} className="chat-scroll" role="log" aria-live="polite">
        {empty ? (
          <div className="welcome">
            <div
              className="welcome-avatar"
              style={{ background: avatarGradient(persona.id) }}
            >
              {avatarEmoji(persona.id, persona.name)}
            </div>
            <h1>{persona.name}</h1>
            <p className="welcome-desc">
              {persona.description.slice(0, 220)}{persona.description.length > 220 ? '…' : ''}
            </p>
            <div className="chips">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="chip"
                  onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                  disabled={isStreaming || !session}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="msgs">
            {messages.map((m, idx) => {
              const isUser = m.role === 'user';
              const isThinkingMsg =
                isStreaming && !isUser && !m.content.trim() && idx === messages.length - 1;
              return (
                <div key={m.id} className={`msg ${m.role}`}>
                  {!isUser && (
                    <div
                      className="msg-avatar"
                      style={{ background: avatarGradient(persona.id) }}
                    >
                      {avatarEmoji(persona.id, persona.name)}
                    </div>
                  )}
                  <div className="msg-body">
                    {isThinkingMsg ? (
                      <Suspense fallback={<OrbFallback />}>
                        <ThinkingOrb size={104} label={`${persona.name} está pensando…`} />
                      </Suspense>
                    ) : (
                      <>
                        <div
                          className="bubble"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content || (isStreaming ? '…' : '')) }}
                        />
                        <div className="msg-foot">
                          <time>
                            {m.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </time>
                          {!isUser && m.content && (
                            <button
                              className="copy-btn"
                              onClick={() => copyMsg(m.id, m.content)}
                              title="Copiar"
                            >
                              {copiedId === m.id ? '✓ copiado' : '⧉ copiar'}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {isStreaming && messages[messages.length - 1]?.role === 'user' && (
              <div className="msg assistant">
                <div className="msg-avatar" style={{ background: avatarGradient(persona.id) }}>
                  {avatarEmoji(persona.id, persona.name)}
                </div>
                <div className="msg-body">
                  <Suspense fallback={<div className="bubble typing"><span /><span /><span /></div>}>
                    <ThinkingOrb size={104} label={`${persona.name} está pensando…`} />
                  </Suspense>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      <div className="composer-wrap">
        <form className="composer" onSubmit={e => { mentions.close(); handleSubmit(e); }}>
          {mentions.mention && mentions.mention.matches.length > 0 && (
            <MentionPopup
              matches={mentions.mention.matches}
              active={mentions.mention.active}
              onPick={completeMention}
            />
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Falar com ${persona.name}… (@ menciona • Enter envia)`}
            rows={1}
            disabled={isStreaming || !session}
            className="composer-input"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming || !session}
            className="send-btn"
            aria-label="Enviar mensagem"
            title="Enviar"
          >
            {isStreaming ? <span className="spinner" /> : <span className="send-icon">↑</span>}
          </button>
        </form>
        <p className="composer-hint">
          {getModelFor(state.settings, persona?.id)} • Shift+Enter quebra linha • streaming em tempo real
        </p>
      </div>
    </div>
  );
}
