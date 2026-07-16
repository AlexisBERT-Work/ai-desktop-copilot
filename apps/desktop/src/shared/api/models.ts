import { invoke } from '@tauri-apps/api/core';

export interface OllamaModelInfo {
  name: string;
  /** Taille disque en octets — proxy du poids VRAM du modèle. */
  sizeBytes: number;
}

export function getOllamaModelsInfo(): Promise<OllamaModelInfo[]> {
  return invoke('get_ollama_models_info');
}

/** VRAM totale du GPU principal (octets), null si indétectable. */
export function getGpuVramBytes(): Promise<number | null> {
  return invoke('get_gpu_vram_bytes');
}

/** Modèle recommandé pour cette machine (règle VRAM du launcher). */
export function getRecommendedModel(): Promise<string> {
  return invoke('get_recommended_model');
}
