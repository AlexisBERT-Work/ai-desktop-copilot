import { invoke } from '@tauri-apps/api/core';

/** État du réglage KV-cache d'Ollama (carte auto-tune des Settings). */
export interface KvCacheStatus {
  current: 'f16' | 'q4_0';
  recommended: 'f16' | 'q4_0';
  managed: boolean;
  vramBytes: number | null;
  modelName: string | null;
  modelBytes: number;
}

/** Pousse au runtime agent les réglages qui le concernent (safe mode…). */
export function updateRuntimeSettings(settings: { safeMode?: boolean | undefined }): Promise<void> {
  // La commande Rust prend `args: UpdateSettingsArgs` → enveloppe sous `args`.
  return invoke('update_settings', { args: settings });
}

export function getKvCacheStatus(): Promise<KvCacheStatus> {
  return invoke('get_kv_cache_status');
}

export function setKvCacheType(value: 'f16' | 'q4_0'): Promise<{ restarted: boolean }> {
  return invoke('set_kv_cache_type', { value });
}
