const GRADIENTS: Record<string, string> = {
  luna: 'linear-gradient(135deg, #ff5a5a, #b04dff)',
  luisa: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
  tux: 'linear-gradient(135deg, #22d3ee, #3b82f6)',
  linus: 'linear-gradient(135deg, #f59e0b, #78716c)',
};

const FALLBACKS = [
  'linear-gradient(135deg, #8b5cf6, #ec4899)',
  'linear-gradient(135deg, #22d3ee, #8b5cf6)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #34d399, #3b82f6)',
  'linear-gradient(135deg, #f472b6, #a78bfa)',
];

export function avatarGradient(id: string): string {
  if (GRADIENTS[id]) return GRADIENTS[id];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACKS[hash % FALLBACKS.length];
}

export function avatarEmoji(id: string, name: string): string {
  if (id === 'tux') return '🐧';
  return name.trim()[0]?.toUpperCase() ?? '✦';
}
