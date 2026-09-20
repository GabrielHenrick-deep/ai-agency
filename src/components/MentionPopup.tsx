import { Personality } from '../types';
import { avatarEmoji, avatarGradient } from '../utils/avatar';
import './MentionPopup.css';

interface Props {
  matches: Personality[];
  active: number;
  onPick: (index: number) => void;
}

export function MentionPopup({ matches, active, onPick }: Props) {
  if (matches.length === 0) return null;
  return (
    <div className="mention-pop" role="listbox" aria-label="Mencionar agente">
      <div className="mention-title">Mencionar agente</div>
      {matches.map((a, i) => (
        <button
          key={a.id}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`mention-item ${i === active ? 'active' : ''}`}
          onMouseDown={e => { e.preventDefault(); onPick(i); }}
        >
          <span className="mention-avatar" style={{ background: avatarGradient(a.id) }}>
            {avatarEmoji(a.id, a.name)}
          </span>
          <span className="mention-name">@{a.name}</span>
        </button>
      ))}
    </div>
  );
}
