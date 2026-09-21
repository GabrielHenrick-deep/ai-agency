import { useState } from 'react';
import { useChat } from '../context/ChatContext';
import { ChatSession, Personality, ProviderConfig } from '../types';
import { avatarEmoji, avatarGradient } from '../utils/avatar';
import { cloudLabel, isOcModel, isZenModel, providerOf } from '../utils/providers';
import { CharacterVisual, toHexCss, visualFor } from '../utils/visuals';
import {
  loadAllPersonalities,
  removeAgent,
  saveCustomPersonality,
} from '../utils/personality';
import { clearSharedState } from '../utils/sync';
import './Sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'sessions' | 'personalities' | 'characters' | 'settings';

/* áreas de uma empresa de T.I p/ a ficha de criação de personagem */
const IT_AREAS = [
  { id: 'dev', icon: '💻', name: 'Desenvolvimento', desc: 'transforma café em código e PRs bem revisados' },
  { id: 'qa', icon: '🧪', name: 'Qualidade (QA)', desc: 'caça bugs antes de chegarem em produção' },
  { id: 'devops', icon: '🛠️', name: 'DevOps & Infra', desc: 'mantém o pipeline verde e os servidores respirando' },
  { id: 'design', icon: '🎨', name: 'Design & UX', desc: 'defende o usuário em todas as reuniões' },
  { id: 'dados', icon: '📊', name: 'Dados', desc: 'transforma planilhas em decisões' },
  { id: 'seg', icon: '🔒', name: 'Segurança', desc: 'desconfia de todo input por padrão' },
  { id: 'produto', icon: '📋', name: 'Produto', desc: 'vira ideia em roadmap antes do café esfriar' },
  { id: 'suporte', icon: '🎧', name: 'Suporte', desc: 'apaga incêndio com sorriso no rosto' },
];

const RPG_NAMES = ['Zilda', 'Orion', 'Kael', 'Nyssa', 'Bruno', 'Fauna', 'Dante', 'Iris'];
const RPG_HAIRS = ['#2b2b33', '#6b3d1f', '#b3541e', '#8a2be2', '#d94f6b', '#e8e0cf'];
const RPG_SKINS = ['#f6cfa8', '#eec39b', '#c98e5f', '#a06a42', '#8a5130', '#f9dcc0'];
const RPG_SHIRTS = ['#8b5cf6', '#2f9e44', '#d23b3b', '#2f6fed', '#e8932e', '#1f9e9e'];
const RPG_PANTS = ['#2b2f36', '#3a3f4a', '#4a3626', '#23301f'];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { state, dispatch, fetchModels } = useChat();
  const [activeTab, setActiveTab] = useState<Tab>('sessions');
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // editor de visual da aba "Bonecos"
  const [editVisualId, setEditVisualId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CharacterVisual | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDraft, setNewDraft] = useState<CharacterVisual | null>(null);
  const [newArea, setNewArea] = useState<string>('');

  const sessions = state.sessions
    .filter(s => s.personalityId === state.currentPersonality?.id)
    .filter(s => {
      if (!query.trim()) return true;
      const first = s.messages.find(m => m.role === 'user')?.content ?? '';
      return first.toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const formatDate = (date: Date) => {
    const d = new Date(date);
    if (d.toDateString() === new Date().toDateString()) {
      return `Hoje ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const getTitle = (s: ChatSession) => {
    const first = s.messages.find(m => m.role === 'user');
    if (first) return first.content.slice(0, 42) + (first.content.length > 42 ? '…' : '');
    return 'Nova conversa';
  };

  const getLastReply = (s: ChatSession) => {
    const found = [...s.messages].reverse()
      .find(m => m.role === 'assistant' && m.content.trim());
    return found?.content ?? '';
  };

  const countRoles = (s: ChatSession) => ({
    user: s.messages.filter(m => m.role === 'user').length,
    assistant: s.messages.filter(m => m.role === 'assistant' && m.content.trim()).length,
  });

  const groups: { label: string; items: ChatSession[] }[] = (() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const isToday = (d: Date) => new Date(d).toDateString() === new Date().toDateString();
    const isYesterday = (d: Date) => {
      const x = new Date(d); x.setHours(0, 0, 0, 0);
      return x.getTime() === yesterday.getTime();
    };
    const t = sessions.filter(s => isToday(new Date(s.updatedAt)));
    const y = sessions.filter(s => isYesterday(new Date(s.updatedAt)));
    const o = sessions.filter(s => !isToday(new Date(s.updatedAt)) && !isYesterday(new Date(s.updatedAt)));
    return [
      { label: 'Hoje', items: t },
      { label: 'Ontem', items: y },
      { label: 'Anteriores', items: o },
    ].filter(g => g.items.length > 0);
  })();

  const newChat = () => {
    if (state.currentPersonality) {
      dispatch({ type: 'CREATE_SESSION', payload: { personalityId: state.currentPersonality.id } });
      if (window.innerWidth < 1100) onClose();
    }
  };

  const selectSession = (s: ChatSession) => {
    dispatch({ type: 'SET_CURRENT_SESSION', payload: s });
    if (window.innerWidth < 1100) onClose();
  };

  const selectPersona = (p: Personality) => {
    dispatch({ type: 'SET_CURRENT_PERSONALITY', payload: p });
    dispatch({ type: 'CREATE_SESSION', payload: { personalityId: p.id } });
    setActiveTab('sessions');
    if (window.innerWidth < 1100) onClose();
  };

  const providers = state.settings.providers;
  const localModels = state.settings.availableModels.filter(
    m => !isZenModel(m) && !isOcModel(m) && !providerOf(m, providers)
  );
  const zenModels = state.settings.availableModels.filter(isZenModel);
  const ocModels = state.settings.availableModels.filter(isOcModel);
  const providerGroups = providers
    .map(p => ({
      provider: p,
      models: state.settings.availableModels.filter(m => m.startsWith(`${p.id}/`)),
    }))
    .filter(g => g.models.length > 0);

  const renderModelOptions = () => (
    <>
      <optgroup label="Ollama (local)">
        {localModels.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </optgroup>
      {ocModels.length > 0 && (
        <optgroup label="OpenCode local">
          {ocModels.map(m => (
            <option key={m} value={m}>{cloudLabel(m, providers)}</option>
          ))}
        </optgroup>
      )}
      {zenModels.length > 0 && (
        <optgroup label="OpenCode Zen (nuvem)">
          {zenModels.map(m => (
            <option key={m} value={m}>{cloudLabel(m, providers)}</option>
          ))}
        </optgroup>
      )}
      {providerGroups.map(g => (
        <optgroup key={g.provider.id} label={g.provider.name}>
          {g.models.map(m => (
            <option key={m} value={m}>{cloudLabel(m, providers)}</option>
          ))}
        </optgroup>
      ))}
    </>
  );

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    dispatch({
      type: 'SET_SETTINGS',
      payload: {
        providers: state.settings.providers.map(p => (p.id === id ? { ...p, ...patch } : p)),
      },
    });
  };

  const addProvider = () => {
    const id = `provider-${Date.now().toString(36)}`;
    dispatch({
      type: 'SET_SETTINGS',
      payload: {
        providers: [
          ...state.settings.providers,
          { id, name: 'Novo provider', baseUrl: '', apiKey: '' },
        ],
      },
    });
  };

  const removeProvider = (id: string) => {
    dispatch({
      type: 'SET_SETTINGS',
      payload: { providers: state.settings.providers.filter(p => p.id !== id) },
    });
  };

  /* ---------- aba Bonecos (visuais 3D) ---------- */

  /** visual atual (customizado ou padrão) de uma persona, no formato do editor */
  const draftFromPersona = (id: string): CharacterVisual => {
    const saved = state.settings.charVisuals[id];
    if (saved) return saved;
    const v = visualFor(id);
    const base: CharacterVisual = {
      hairStyle: v.hairStyle,
      hair: toHexCss(v.hair),
      skin: toHexCss(v.skin),
      shirt: toHexCss(v.shirt),
      pants: toHexCss(v.pants),
      hat: v.hat !== false,
    };
    return base;
  };

  /** liga/desliga a fedora de UM boneco (atualiza na hora, sem abrir o editor) */
  const toggleHat = (id: string) => {
    const cur = draftFromPersona(id);
    dispatch({
      type: 'SET_SETTINGS',
      payload: { charVisuals: { ...state.settings.charVisuals, [id]: { ...cur, hat: !cur.hat } } },
    });
  };

  const saveVisual = () => {
    if (!editVisualId || !draft) return;
    dispatch({
      type: 'SET_SETTINGS',
      payload: { charVisuals: { ...state.settings.charVisuals, [editVisualId]: draft } },
    });
    setEditVisualId(null);
    setDraft(null);
  };

  const resetVisual = (id: string) => {
    const next = { ...state.settings.charVisuals };
    delete next[id];
    dispatch({ type: 'SET_SETTINGS', payload: { charVisuals: next } });
    setEditVisualId(null);
    setDraft(null);
  };

  const NEW_DEFAULT: CharacterVisual = {
    hairStyle: 'curto',
    hair: '#2b2b33',
    skin: '#f6cfa8',
    shirt: '#f4f4f6',
    pants: '#2b2f36',
    hat: true,
  };

  const createCharacter = async () => {
    if (!newName.trim()) return;
    const area = IT_AREAS.find(a => a.id === newArea);
    const desc = newDesc.trim()
      || (area ? `${area.name}: ${area.desc}` : 'novo colega do escritório');
    const persona = saveCustomPersonality(newName, desc);
    dispatch({
      type: 'SET_SETTINGS',
      payload: {
        charVisuals: { ...state.settings.charVisuals, [persona.id]: newDraft ?? NEW_DEFAULT },
      },
    });
    dispatch({ type: 'SET_PERSONALITIES', payload: await loadAllPersonalities() });
    setNewName('');
    setNewDesc('');
    setNewArea('');
    setNewDraft(null);
  };

  /** preenche a ficha no aleatório 🎲 (nome, área e visual) */
  const rollCharacter = () => {
    const area = pick(IT_AREAS);
    setNewArea(area.id);
    if (!newName.trim()) setNewName(pick(RPG_NAMES));
    setNewDesc(`${area.name}: ${area.desc}`);
    setNewDraft({
      hairStyle: pick(['curto', 'long', 'ponytail'] as const),
      hair: pick(RPG_HAIRS),
      skin: pick(RPG_SKINS),
      shirt: pick(RPG_SHIRTS),
      pants: pick(RPG_PANTS),
    });
  };

  /** remove um agente da equipe (custom ou fixo). O Tux é intocável 🐧. */
  const removeCharacter = async (id: string) => {
    if (!removeAgent(id)) return;
    const nextVisuals = { ...state.settings.charVisuals };
    delete nextVisuals[id];
    const nextModels = { ...state.settings.personalityModels };
    delete nextModels[id];
    dispatch({ type: 'SET_SETTINGS', payload: { charVisuals: nextVisuals, personalityModels: nextModels } });
    // leva junto as conversas dele
    state.sessions
      .filter(s => s.personalityId === id)
      .forEach(s => dispatch({ type: 'DELETE_SESSION', payload: s.id }));
    dispatch({ type: 'SET_PERSONALITIES', payload: await loadAllPersonalities() });
  };

  /** campos do editor de visual (recomendado por criação/edição) */
  const renderVisualForm = (
    value: CharacterVisual,
    onChange: (v: CharacterVisual) => void
  ) => (
    <div className="char-form">
      <label>
        Cabelo
        <select
          className="field sm"
          value={value.hairStyle}
          onChange={e => onChange({ ...value, hairStyle: e.target.value as CharacterVisual['hairStyle'] })}
        >
          <option value="curto">Curto (capacete)</option>
          <option value="long">Longo</option>
          <option value="ponytail">Rabo de cavalo</option>
        </select>
      </label>
      <label>
        Cor do cabelo
        <input type="color" value={value.hair} onChange={e => onChange({ ...value, hair: e.target.value })} />
      </label>
      <label>
        Cor da pele
        <input type="color" value={value.skin} onChange={e => onChange({ ...value, skin: e.target.value })} />
      </label>
      <label>
        Camiseta
        <input type="color" value={value.shirt} onChange={e => onChange({ ...value, shirt: e.target.value })} />
      </label>
      <label>
        Calça
        <input type="color" value={value.pants} onChange={e => onChange({ ...value, pants: e.target.value })} />
      </label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={value.hat !== false}
          onChange={e => onChange({ ...value, hat: e.target.checked })}
        />
        Usar fedora 🎩
      </label>
    </div>
  );

  return (
    <>
      <aside className={`side ${isOpen ? 'open' : ''}`}>
        <div className="side-head">
          <div className="brand">
            <div className="brand-orb">✦</div>
            <div>
              <div className="brand-name">Agent Chat</div>
              <div className="brand-sub">{state.personalities.length} agentes • local</div>
            </div>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        <div className="tabs" role="tablist">
          {([
            { id: 'sessions', label: 'Chats', icon: '💬' },
            { id: 'personalities', label: 'Agentes', icon: '🤖' },
            { id: 'characters', label: 'Bonecos', icon: '🧍' },
            { id: 'settings', label: 'Ajustes', icon: '⚙️' },
          ] as { id: Tab; label: string; icon: string }[]).map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={activeTab === t.id ? 'active' : ''}
              onClick={() => setActiveTab(t.id)}
              title={t.label}
            >
              <span className="tab-ico" aria-hidden="true">{t.icon}</span>
              <span className="tab-lbl">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="side-body">
          {activeTab === 'sessions' && (
            <>
              <button className="cta" onClick={newChat}>
                <span className="cta-plus">+</span> Nova conversa
              </button>
              <input
                className="search"
                placeholder="Buscar conversa…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <div className="list">
                {sessions.length === 0 && <p className="empty">Nenhuma conversa ainda. Clique em Nova conversa.</p>}
                {groups.map(g => (
                  <div key={g.label}>
                    <div className="group-label">{g.label}</div>
                    {g.items.map(s => {
                      const isOpen = expandedId === s.id;
                      const reply = getLastReply(s);
                      const counts = countRoles(s);
                      return (
                        <div
                          key={s.id}
                          className={`row-wrap ${state.currentSession?.id === s.id ? 'active' : ''}`}
                        >
                          <div
                            className="row"
                            onClick={() => selectSession(s)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && selectSession(s)}
                          >
                            <div className="row-main">
                              <div className="row-title">{getTitle(s)}</div>
                            </div>
                            <button
                              className={`mini static expand-btn ${isOpen ? 'open' : ''}`}
                              title={isOpen ? 'Ocultar resposta' : 'Ver resposta do agente'}
                              aria-label={isOpen ? 'Ocultar resposta do agente' : 'Ver resposta do agente'}
                              aria-expanded={isOpen}
                              onClick={e => {
                                e.stopPropagation();
                                setExpandedId(isOpen ? null : s.id);
                              }}
                            >
                              ▾
                            </button>
                            <button
                              className="mini danger"
                              title="Excluir conversa"
                              aria-label={`Excluir conversa "${getTitle(s)}"`}
                              onClick={e => {
                                e.stopPropagation();
                                setPendingDelete(s);
                              }}
                            >
                              🗑
                            </button>
                          </div>
                          {isOpen && (
                            <div className="row-output">
                              <div className="row-output-meta">
                                {counts.user} sua(s) • {counts.assistant} resposta(s) do agente
                              </div>
                              {reply ? (
                                <div className="row-output-text">{reply}</div>
                              ) : (
                                <div className="row-output-text row-output-empty">
                                  O agente ainda não respondeu nesta conversa.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'personalities' && (
            <div className="plist">
              {state.personalities.map(p => {
                const active = state.currentPersonality?.id === p.id;
                const custom = state.settings.personalityModels[p.id] ?? '';
                return (
                  <div
                    key={p.id}
                    className={`pcard ${active ? 'active' : ''}`}
                    style={{ position: 'relative' }}
                  >
                    {p.id !== 'tux' && (
                      <button
                        className="mini danger p-del"
                        title="Remover agente da equipe (o Tux é fixo 🐧)"
                        aria-label={`Remover agente ${p.name}`}
                        onClick={() => removeCharacter(p.id)}
                      >
                        🗑
                      </button>
                    )}
                    <button className="pcard-main" onClick={() => selectPersona(p)}>
                      <div className="pavatar" style={{ background: avatarGradient(p.id) }}>
                        {avatarEmoji(p.id, p.name)}
                      </div>
                      <div className="pinfo">
                        <div className="pname">{p.name} {active && <span className="badge">selecionado</span>}</div>
                        <div className="pdesc">{p.description.slice(0, 90)}…</div>
                      </div>
                    </button>
                    <label className="pcard-model">
                      <span>Modelo</span>
                      <select
                        value={custom}
                        onChange={e => {
                          const next = { ...state.settings.personalityModels };
                          if (e.target.value) next[p.id] = e.target.value;
                          else delete next[p.id];
                          dispatch({ type: 'SET_SETTINGS', payload: { personalityModels: next } });
                        }}
                        className="field sm"
                        title="Modelo deste agente (vazio = padrão global)"
                      >
                        <option value="">Padrão global</option>
                        {renderModelOptions()}
                      </select>
                    </label>
                  </div>
                );
              })}
              {state.personalities.length === 0 && <p className="empty">Nenhum agente carregado.</p>}
            </div>
          )}

          {activeTab === 'characters' && (
            <div className="char-list">
              <p className="tip" style={{ marginTop: 0 }}>
                Aparência 3D dos bonecos no escritório. Cada mudança atualiza a cena na hora.
                O chapéu (fedora 🎩) pode ser ligado/desligado por boneco.
              </p>

              {/* o SEU boneco também é personalizável (com fedora!) */}
              {(() => {
                const editingYou = editVisualId === 'you';
                return (
                  <div className="pcard you-card">
                    <div className="chrow-head">
                      <div className="pavatar" style={{ background: avatarGradient('you') }}>🧑</div>
                      <div className="pinfo">
                        <div className="pname">Você</div>
                        <div className="pdesc">Seu boneco no escritório (o de fedora)</div>
                      </div>
                      <button
                        className="mini static"
                        title={visualFor('you', state.settings.charVisuals).hat !== false ? 'Tirar a fedora' : 'Colocar a fedora'}
                        onClick={() => toggleHat('you')}
                      >
                        {visualFor('you', state.settings.charVisuals).hat !== false ? '🎩' : '🧢'}
                      </button>
                      <button
                        className="mini static"
                        title={editingYou ? 'Fechar editor' : 'Editar visual'}
                        onClick={() => {
                          if (editingYou) {
                            setEditVisualId(null);
                            setDraft(null);
                          } else {
                            setEditVisualId('you');
                            setDraft(draftFromPersona('you'));
                          }
                        }}
                      >
                        {editingYou ? 'fechar' : '✏️ visual'}
                      </button>
                    </div>
                    {editingYou && draft && (
                      <>
                        {renderVisualForm(draft, setDraft)}
                        <div className="char-actions">
                          <button className="mini static" onClick={saveVisual}>✔ aplicar</button>
                          <button className="mini" onClick={() => resetVisual('you')} title="Volta ao visual padrão">
                            restaurar padrão
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {state.personalities.map(p => {
                const editing = editVisualId === p.id;
                const isPenguin = p.id === 'tux';
                return (
                  <div key={p.id} className="pcard">
                    <div className="chrow-head">
                      <div className="pavatar" style={{ background: avatarGradient(p.id) }}>
                        {avatarEmoji(p.id, p.name)}
                      </div>
                      <div className="pinfo">
                        <div className="pname">{p.name}</div>
                      </div>
                      <button
                        className="mini static"
                        title={visualFor(p.id, state.settings.charVisuals).hat !== false ? 'Tirar a fedora' : 'Colocar a fedora'}
                        onClick={() => toggleHat(p.id)}
                      >
                        {visualFor(p.id, state.settings.charVisuals).hat !== false ? '🎩' : '🧢'}
                      </button>
                      {!isPenguin && (
                        <button
                          className="mini static"
                          title={editing ? 'Fechar editor' : 'Editar visual'}
                          onClick={() => {
                            if (editing) {
                              setEditVisualId(null);
                              setDraft(null);
                            } else {
                              setEditVisualId(p.id);
                              setDraft(draftFromPersona(p.id));
                            }
                          }}
                        >
                          {editing ? 'fechar' : '✏️ visual'}
                        </button>
                      )}
                      {!isPenguin && (
                        <button
                          className="mini danger"
                          title="Remover agente da equipe"
                          aria-label={`Remover agente ${p.name}`}
                          onClick={() => removeCharacter(p.id)}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                    {editing && draft && (
                      <>
                        {renderVisualForm(draft, setDraft)}
                        <div className="char-actions">
                          <button className="mini static" onClick={saveVisual}>✔ aplicar</button>
                          <button className="mini" onClick={() => resetVisual(p.id)} title="Volta ao visual padrão">
                            restaurar padrão
                          </button>
                        </div>
                      </>
                    )}
                    {isPenguin && (
                      <div className="row-output-meta">O Tux é um pinguim — sem roupas pra trocar 🐧</div>
                    )}
                  </div>
                );
              })}

              <div className={`pcard rpg-card ${newDraft ? 'open' : ''}`}>
                <button
                  className="pcard-main"
                  onClick={() => setNewDraft(newDraft ? null : { ...NEW_DEFAULT })}
                >
                  <div className="pavatar rpg-avatar">🆕</div>
                  <div className="pinfo">
                    <div className="pname">Contratar colega</div>
                    <div className="pdesc">Monte a ficha: nome, área da empresa e visual</div>
                  </div>
                </button>
                {newDraft && (
                  <div className="rpg-sheet">
                    <div className="rpg-banner">🪪 FICHA DE NOVO COLABORADOR</div>

                    <label className="rpg-field">
                      Nome
                      <input
                        className="field sm"
                        value={newName}
                        placeholder="Ex.: Mariana Souza"
                        onChange={e => setNewName(e.target.value)}
                      />
                    </label>

                    <div className="rpg-label">Área da empresa</div>
                    <div className="rpg-classes">
                      {IT_AREAS.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          className={`rpg-class ${newArea === a.id ? 'picked' : ''}`}
                          title={`${a.name} — ${a.desc}`}
                          onClick={() => {
                            setNewArea(a.id);
                            setNewDesc(`${a.name}: ${a.desc}`);
                          }}
                        >
                          <span className="rpg-class-ico">{a.icon}</span>
                          <span className="rpg-class-name">{a.name}</span>
                        </button>
                      ))}
                    </div>

                    <label className="rpg-field">
                      Função (o que ele faz)
                      <input
                        className="field sm"
                        value={newDesc}
                        placeholder="Ex.: desenvolvedor front-end React"
                        onChange={e => setNewDesc(e.target.value)}
                      />
                    </label>

                    <div className="rpg-label">Aparência</div>
                    {renderVisualForm(newDraft, setNewDraft)}

                    <div className="char-actions">
                      <button className="mini" onClick={rollCharacter} title="Preenche nome, área e visual no aleatório">
                        🎲 aleatório
                      </button>
                      <button
                        className="mini static rpg-create"
                        onClick={createCharacter}
                        disabled={!newName.trim()}
                        title={newName.trim() ? 'Adicionar ao escritório' : 'Dê um nome primeiro'}
                      >
                        ➕ contratar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="settings">
              <div className="set-card">
                <div className="set-head">
                  <label>Modelo padrão (global)</label>
                  <button className="mini" onClick={fetchModels} title="Buscar modelos">⟳ atualizar</button>
                </div>
                <select
                  value={state.settings.defaultModel}
                  onChange={e => dispatch({ type: 'SET_SETTINGS', payload: { defaultModel: e.target.value } })}
                  className="field"
                >
                  {renderModelOptions()}
                </select>
                {state.settings.availableModels.length === 0 && (
                  <p className="warn">Ollama offline? Rode <code>ollama serve</code> e clique em atualizar.</p>
                )}
              </div>

              <div className="set-card">
                <label>OpenCode Zen (API key)</label>
                <input
                  className="field"
                  type="password"
                  placeholder="Cole sua chave aqui…"
                  autoComplete="off"
                  value={state.settings.zenApiKey}
                  onChange={e => dispatch({ type: 'SET_SETTINGS', payload: { zenApiKey: e.target.value } })}
                />
                <p className="tip">
                  Modelos na nuvem (Claude, GPT, Kimi, GLM…) aparecem no grupo “OpenCode Zen” das listas
                  e podem ser escolhidos por agente. Crie a chave em{' '}
                  <a href="https://opencode.ai/zen" target="_blank" rel="noreferrer">opencode.ai/zen</a>.
                </p>
              </div>

              <div className="set-card">
                <div className="set-head">
                  <label>Providers (OpenAI-compatible)</label>
                  <button className="mini" onClick={addProvider} title="Adicionar provider">+ adicionar</button>
                </div>
                {state.settings.providers.map(p => (
                  <div className="provider-row" key={p.id}>
                    <input
                      className="field sm p-name"
                      value={p.name}
                      placeholder="Nome"
                      onChange={e => updateProvider(p.id, { name: e.target.value })}
                    />
                    <input
                      className="field sm p-url"
                      value={p.baseUrl}
                      placeholder="https://…/v1"
                      spellCheck={false}
                      onChange={e => updateProvider(p.id, { baseUrl: e.target.value })}
                    />
                    <input
                      className="field sm p-key"
                      type="password"
                      autoComplete="off"
                      value={p.apiKey}
                      placeholder="API key"
                      onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                    />
                    <button
                      className="mini danger"
                      onClick={() => removeProvider(p.id)}
                      title="Remover provider"
                      aria-label={`Remover provider ${p.name}`}
                    >
                      🗑
                    </button>
                  </div>
                ))}
                <p className="tip">
                  Qualquer API compatível com OpenAI (chat/completions): OpenRouter, Groq, Together, LM Studio…
                  No OpenRouter, os modelos com sufixo <code>:free</code> são grátis — crie a chave em{' '}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>{' '}
                  e depois clique em ⟳ atualizar.
                </p>
                <p className="tip">
                  Já o grupo <b>OpenCode local</b> não precisa de chave nova: usa os providers que você
                  já logou no opencode desta máquina (sobe um <code>opencode serve</code> sozinho).
                </p>
              </div>

              <div className="set-card">
                <label>Temperatura: <b>{state.settings.temperature}</b></label>
                <input
                  type="range" min={0} max={2} step={0.1}
                  value={state.settings.temperature}
                  onChange={e => dispatch({ type: 'SET_SETTINGS', payload: { temperature: parseFloat(e.target.value) } })}
                />
                <label style={{ marginTop: 12 }}>Max tokens: <b>{state.settings.maxTokens}</b></label>
                <input
                  type="range" min={256} max={8192} step={256}
                  value={state.settings.maxTokens}
                  onChange={e => dispatch({ type: 'SET_SETTINGS', payload: { maxTokens: parseInt(e.target.value) } })}
                />
                <p className="tip">Qwen 3.5 precisa de 4096+ por causa do thinking.</p>
              </div>

              <div className="set-card">
                <label>URL do Ollama</label>
                <input
                  className="field"
                  value={state.settings.ollamaUrl}
                  onChange={e => dispatch({ type: 'SET_SETTINGS', payload: { ollamaUrl: e.target.value } })}
                />
              </div>

              <button
                className="danger-btn"
                onClick={() => setShowClearAll(true)}
              >
                Limpar todos os dados
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className={`overlay ${isOpen ? 'show' : ''}`} onClick={onClose} />

      {pendingDelete && (
        <div
          className="modal-overlay"
          onClick={() => setPendingDelete(null)}
          onKeyDown={e => e.key === 'Escape' && setPendingDelete(null)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="del-title"
            aria-describedby="del-desc"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-icon">🗑</div>
            <h3 id="del-title">Excluir conversa?</h3>
            <p id="del-desc" className="modal-desc">
              “{getTitle(pendingDelete)}” será apagada permanentemente. Essa ação não pode ser desfeita.
            </p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setPendingDelete(null)} autoFocus>
                Cancelar
              </button>
              <button
                className="modal-btn danger-solid"
                onClick={() => {
                  dispatch({ type: 'DELETE_SESSION', payload: pendingDelete.id });
                  setPendingDelete(null);
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearAll && (
        <div className="modal-overlay" onClick={() => setShowClearAll(false)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-icon">⚠️</div>
            <h3 id="clear-title">Apagar tudo?</h3>
            <p className="modal-desc">
              Todas as conversas, personas ativas e configurações serão removidas deste navegador.
            </p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowClearAll(false)} autoFocus>
                Cancelar
              </button>
              <button
                className="modal-btn danger-solid"
                onClick={async () => {
                  await clearSharedState(); // apaga também no servidor (PC/celular)
                  localStorage.clear();
                  window.location.reload();
                }}
              >
                Apagar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
