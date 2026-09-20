/**
 * Estado compartilhado entre dispositivos (PC ↔ celular).
 * O backend guarda um JSON por chave no Postgres (/api/state/:key).
 * Se o banco estiver fora, tudo cai pro comportamento antigo (localStorage).
 */

export type SharedKey = 'sessions' | 'settings' | 'customPersonas' | 'hiddenAgents';

/** Lê o valor compartilhado. null = não existe no servidor / servidor fora. */
export async function pullSharedState(key: SharedKey): Promise<unknown | null> {
  try {
    const res = await fetch(`/api/state/${key}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
  }
}

/** Grava o valor compartilhado (fire-and-forget: falha silenciosa se o banco cair). */
export function pushSharedState(key: SharedKey, value: unknown): void {
  fetch(`/api/state/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

/** Apaga TODO o estado compartilhado (usado no "Limpar todos os dados"). */
export async function clearSharedState(): Promise<void> {
  try {
    await fetch('/api/state', { method: 'DELETE' });
  } catch {
    /* banco fora: ok, o local já foi limpo */
  }
}
