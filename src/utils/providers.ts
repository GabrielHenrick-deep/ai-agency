import type { ProviderConfig } from '../types';

/** Prefixo que marca modelos do opencode local (ex.: "oc/opencode/big-pickle"). */
export const OC_PREFIX = 'oc/';

/** Prefixo que marca modelos servidos pelo OpenCode Zen (ex.: "opencode/kimi-k2.6"). */
export const ZEN_PREFIX = 'opencode/';

export function isZenModel(model: string): boolean {
  return model.startsWith(ZEN_PREFIX);
}

export function isOcModel(model: string): boolean {
  return model.startsWith(OC_PREFIX);
}

/** True se o modelo não é servido pelo Ollama local (zen, opencode local ou provider genérico). */
export function isCloudModel(model: string, providers: ProviderConfig[]): boolean {
  return isZenModel(model) || isOcModel(model) || !!providerOf(model, providers);
}

/** Provider (configurado) dono de um modelo, pelo prefixo "<id>/". */
export function providerOf(model: string, providers: ProviderConfig[]): ProviderConfig | null {
  return providers.find(p => model.startsWith(`${p.id}/`)) ?? null;
}

/** Nome amigável sem o prefixo do provider, para exibição na UI. */
export function cloudLabel(model: string, providers: ProviderConfig[]): string {
  if (isZenModel(model)) return model.slice(ZEN_PREFIX.length);
  if (isOcModel(model)) return model.slice(OC_PREFIX.length);
  const p = providerOf(model, providers);
  return p ? model.slice(p.id.length + 1) : model;
}
