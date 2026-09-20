import { Suspense, lazy, useEffect, useState } from 'react';
import { ChatProvider, getModelFor, useChat } from './context/ChatContext';
import { ChatInterface } from './components/ChatInterface';
import { Sidebar } from './components/Sidebar';
import { avatarEmoji, avatarGradient } from './utils/avatar';
import { cloudLabel } from './utils/providers';
import './App.css';

const Office3D = lazy(() => import('./components/Office3D').then(m => ({ default: m.Office3D })));

type View = 'chat' | 'office';

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<View>('chat');
  const { state, dispatch } = useChat();

  useEffect(() => {
    if (window.innerWidth >= 1100) setSidebarOpen(true);
  }, []);

  if (state.isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-orb" />
        <h2>AI Agent Chat</h2>
        <p>Carregando agentes…</p>
      </div>
    );
  }

  const p = state.currentPersonality;

  return (
    <div className="app">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="main-content">
        <header className="top-bar">
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="Alternar menu"
          >
            <span className="icon">☰</span>
          </button>

          <div className="top-persona">
            {p ? (
              <>
                <div
                  className="top-avatar"
                  style={{ background: avatarGradient(p.id) }}
                >
                  {avatarEmoji(p.id, p.name)}
                </div>
                <div className="top-meta">
                  <div className="top-name">
                    {p.name}
                    <span className="presence" title="online" />
                  </div>
                  <div className="top-sub">
                    <span className="model-pill" title={p.id in state.settings.personalityModels ? 'Modelo específico deste agente' : 'Modelo padrão global'}>{cloudLabel(getModelFor(state.settings, p?.id), state.settings.providers)}</span>
                    <span className="dot">•</span>
                    <span className="count">
                      {state.currentSession
                        ? state.currentSession.messages.filter(m => m.role !== 'system').length
                        : 0}{' '}
                      msgs
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="top-meta">
                <div className="top-name">AI Agent Chat</div>
                <div className="top-sub">escolha um agente</div>
              </div>
            )}
          </div>

          <div className="top-actions">
            <div className="view-toggle" role="tablist" aria-label="Alternar vista">
              <button
                role="tab"
                aria-selected={view === 'chat'}
                className={view === 'chat' ? 'active' : ''}
                onClick={() => setView('chat')}
                title="Chat"
              >
                💬
              </button>
              <button
                role="tab"
                aria-selected={view === 'office'}
                className={view === 'office' ? 'active' : ''}
                onClick={() => setView('office')}
                title="Escritório 3D"
              >
                🏢
              </button>
            </div>
            {view === 'chat' && (
              <button
                className="ghost-btn"
                onClick={() => {
                  if (p) dispatch({ type: 'CREATE_SESSION', payload: { personalityId: p.id } });
                }}
                disabled={!p}
              >
                <span>+</span> Nova conversa
              </button>
            )}
          </div>
        </header>

        {view === 'chat' ? (
          <ChatInterface onOpenMenu={() => setSidebarOpen(true)} />
        ) : (
          <Suspense
            fallback={
              <div className="app-loading">
                <div className="loading-orb" />
                <p>Montando o escritório…</p>
              </div>
            }
          >
            <Office3D />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  );
}

export default App;
