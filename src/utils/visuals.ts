/** Visuais 3D das personas (compartilhado entre Office3D e a aba de personalização). */

export interface Visual {
  kind: 'human' | 'penguin';
  skin: number;
  hair: number;
  hairStyle: 'curto' | 'long' | 'ponytail';
  blazer: number;
  shirt: number;
  tie: number;
  pants: number;
  accent: string;
  /** fedora ligada/desligada (padrão: ligada) */
  hat?: boolean;
}

/** Visual editável pelo usuário (cores em string CSS, ex.: "#f6cfa8"). */
export interface CharacterVisual {
  hairStyle: 'curto' | 'long' | 'ponytail';
  hair: string;
  skin: string;
  shirt: string;
  pants: string;
  /** fedora ligada/desligada por boneco (padrão: ligada) */
  hat?: boolean;
}

export const VISUALS: Record<string, Visual> = {
  luna: { kind: 'human', skin: 0xf6cfa8, hair: 0xc23a1d, hairStyle: 'long', blazer: 0x6b3fb5, shirt: 0xf7efdd, tie: 0x8b5cf6, pants: 0x2b2f36, accent: '#8b5cf6' },
  luisa: { kind: 'human', skin: 0xf0c496, hair: 0xc24a1a, hairStyle: 'ponytail', blazer: 0xe26a1d, shirt: 0x2b2f36, tie: 0x22d3ee, pants: 0x2b2f36, accent: '#22d3ee' },
  tux: { kind: 'penguin', skin: 0x1a1a1e, hair: 0x1a1a1e, hairStyle: 'curto', blazer: 0x1a1a1e, shirt: 0xffffff, tie: 0xd23b3b, pants: 0x1a1a1e, accent: '#4dc9ff' },
  linus: { kind: 'human', skin: 0xe8b88a, hair: 0x8a8a8a, hairStyle: 'curto', blazer: 0x23262e, shirt: 0x141414, tie: 0x78716c, pants: 0x2b2f36, accent: '#f59e0b' },
  // o boneco do USUÁRIO na cena (editável na aba Bonecos)
  you: { kind: 'human', skin: 0xb57748, hair: 0x1f1a16, hairStyle: 'curto', blazer: 0x1f9e9e, shirt: 0xf4f2ea, tie: 0x1f9e9e, pants: 0x2b2f36, accent: '#4ade80' },
};

const FALLBACKS: Visual[] = [
  { kind: 'human', skin: 0xf6cfa8, hair: 0x3a2a1c, hairStyle: 'long', blazer: 0x2f9e44, shirt: 0xf7efdd, tie: 0x34d399, pants: 0x2b2f36, accent: '#34d399' },
  { kind: 'human', skin: 0xc98d5e, hair: 0x141414, hairStyle: 'ponytail', blazer: 0x2f6fed, shirt: 0xffffff, tie: 0xf59e0b, pants: 0x2b2f36, accent: '#f59e0b' },
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

function parseHex(c: string, fallback: number): number {
  const n = parseInt(c.replace('#', ''), 16);
  return Number.isFinite(n) ? n : fallback;
}

/** "#rrggbb" → número 0xrrggbb (com fallback se vier lixo). */
export function parseHexColor(c: string, fallback: number): number {
  return parseHex(c, fallback);
}

/** "#rrggbb" de uma cor numérica (para pré-preencher o editor). */
export function toHexCss(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Visual efetivo: base do personagem + customização salva (se houver). */
export function visualFor(id: string, charVisuals?: Record<string, CharacterVisual>): Visual {
  const base = VISUALS[id] ?? FALLBACKS[hashId(id) % FALLBACKS.length];
  const ov = charVisuals?.[id];
  if (!ov) return { ...base, hat: base.hat ?? true };
  return {
    ...base,
    hairStyle: ov.hairStyle,
    hair: parseHex(ov.hair, base.hair),
    skin: parseHex(ov.skin, base.skin),
    shirt: parseHex(ov.shirt, base.shirt),
    pants: parseHex(ov.pants, base.pants),
    hat: ov.hat ?? base.hat ?? true,
  };
}
