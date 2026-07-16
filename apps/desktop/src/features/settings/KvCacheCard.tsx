import { useState, useEffect, useCallback } from 'react';
import { Zap, Check, Loader2 } from 'lucide-react';
import { getKvCacheStatus, setKvCacheType, type KvCacheStatus } from '../../shared/api/settings';

const KV_LABEL: Record<'f16' | 'q4_0', string> = {
  f16: 'Standard (f16)',
  q4_0: 'Compact 4-bit (q4_0)',
};

function gb(bytes: number): string {
  return `${(Math.round((bytes / 1e9) * 10) / 10).toFixed(1)} Go`;
}

/**
 * Auto-tune card: detects the GPU VRAM and the heaviest installed model, then
 * recommends the KV-cache type. On a CatDesk-managed Ollama it applies in one
 * click (and restarts Ollama); with an external Ollama it shows the manual env
 * var, since CatDesk must not touch a server the user runs themselves.
 */
export function KvCacheCard() {
  const [status, setStatus] = useState<KvCacheStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getKvCacheStatus());
    } catch {
      setStatus(null); // Ollama unreachable → hide the card
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = useCallback(
    async (value: 'f16' | 'q4_0') => {
      setBusy(true);
      setNote(null);
      try {
        const res = await setKvCacheType(value);
        setNote(
          res.restarted
            ? 'Appliqué — Ollama redémarré.'
            : 'Enregistré — actif au prochain démarrage de CatDesk.',
        );
        await refresh();
      } catch (e) {
        setNote(`Échec : ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (!status) return null;

  const { current, recommended, managed, vramBytes, modelName, modelBytes } = status;
  const optimal = current === recommended;
  const recBoost = recommended === 'q4_0'; // q4 is recommended → a heavy model is VRAM-tight

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-brand-400" />
        <p className="text-sm font-medium text-white/90">Performance GPU — cache KV</p>
      </div>

      {/* Detected hardware */}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/3">
          <span className="text-white/40">VRAM</span>
          <span className="text-white/70">{vramBytes ? gb(vramBytes) : 'inconnue'}</span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/3">
          <span className="text-white/40">Modèle lourd</span>
          <span className="text-white/70 truncate">
            {modelName ? `${modelName} (${gb(modelBytes)})` : '—'}
          </span>
        </div>
      </div>

      {/* Recommendation */}
      {optimal ? (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <Check className="w-3.5 h-3.5" />
          {managed ? 'Réglé automatiquement pour ce PC' : 'Réglage optimal pour ce PC'} :
          <span className="font-medium">{KV_LABEL[current]}</span>
        </div>
      ) : (
        <p className="text-xs text-white/55 leading-relaxed">
          {recBoost
            ? `Ton modèle lourd est à l'étroit en VRAM. Le cache 4-bit libère de la mémoire pour garder plus de couches sur le GPU (jusqu'à ~+50 % de vitesse sur ce modèle, ~−6 % sur les petits).`
            : `Tu as assez de VRAM : le cache standard f16 est le plus rapide ici (le 4-bit coûterait ~6 % pour rien).`}{' '}
          Reco : <span className="font-medium text-white/80">{KV_LABEL[recommended]}</span>.
        </p>
      )}

      {/* Apply / guidance */}
      {managed ? (
        <div className="flex items-center gap-2">
          <button
            disabled={busy || optimal}
            onClick={() => apply(recommended)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${
                optimal
                  ? 'bg-white/5 text-white/30 cursor-default'
                  : 'bg-brand-500/20 text-brand-300 hover:bg-brand-500/30'
              }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {optimal ? 'Déjà appliqué' : `Appliquer la reco (${KV_LABEL[recommended]})`}
          </button>
          {!optimal && (
            <button
              disabled={busy}
              onClick={() => apply(current === 'f16' ? 'q4_0' : 'f16')}
              className="px-3 py-1.5 rounded-lg text-xs text-white/45 hover:text-white/70 hover:bg-white/5 transition-colors"
            >
              Forcer {KV_LABEL[current === 'f16' ? 'q4_0' : 'f16']}
            </button>
          )}
        </div>
      ) : (
        !optimal && (
          <div className="text-xs text-white/45 space-y-1.5">
            <p>Ollama externe détecté — applique le réglage toi-même puis redémarre Ollama :</p>
            <code className="block px-2.5 py-1.5 rounded-lg bg-black/30 text-white/70 font-mono text-[11px]">
              {recommended === 'q4_0'
                ? 'setx OLLAMA_KV_CACHE_TYPE q4_0 ; setx OLLAMA_FLASH_ATTENTION 1'
                : 'setx OLLAMA_KV_CACHE_TYPE ""'}
            </code>
          </div>
        )
      )}

      {note && <p className="text-xs text-white/40">{note}</p>}
    </div>
  );
}
