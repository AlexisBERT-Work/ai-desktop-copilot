import { useSettingsStore } from './settingsStore';
import { useChatStore } from '../chat/store/chatStore';
import { KvCacheCard } from './KvCacheCard';

/** Onglet Modèle : choix du modèle Ollama, auto-tune GPU, température, itérations, streaming. */
export function ModelTab() {
  const { availableModels } = useChatStore();
  const {
    defaultModel,
    temperature,
    maxIterations,
    streamingEnabled,
    setDefaultModel,
    setTemperature,
    setMaxIterations,
    setStreamingEnabled,
  } = useSettingsStore();

  const models = availableModels.length > 0 ? availableModels : [defaultModel];

  return (
    <div className="space-y-6">
      {/* Model selector */}
      <div>
        <label className="block text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
          Modèle Ollama
        </label>
        <select
          value={defaultModel}
          onChange={e => setDefaultModel(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90
                     focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20
                     appearance-none cursor-pointer"
        >
          {models.map(m => (
            <option key={m} value={m} className="bg-gray-900 text-white">
              {m}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-white/30">
          Les modèles disponibles sont chargés depuis Ollama au démarrage.
        </p>
      </div>

      {/* GPU auto-tune (KV cache) */}
      <KvCacheCard />

      {/* Temperature */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider">
            Température
          </label>
          <span className="text-sm font-mono text-brand-400">{temperature.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={e => setTemperature(parseFloat(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none bg-white/10
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
                     [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-brand-400 [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-white/25">Précis (0)</span>
          <span className="text-xs text-white/25">Créatif (2)</span>
        </div>
      </div>

      {/* Max iterations */}
      <div>
        <label className="block text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
          Itérations max. (ReAct loop)
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={25}
            value={maxIterations}
            onChange={e =>
              setMaxIterations(Math.max(1, Math.min(25, parseInt(e.target.value, 10) || 1)))
            }
            className="w-20 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90
                       text-center focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20"
          />
          <span className="text-xs text-white/40">
            Nombre de tours agent max. avant abandon (1–25)
          </span>
        </div>
      </div>

      {/* Streaming toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/80">Streaming des tokens</p>
          <p className="text-xs text-white/35 mt-0.5">
            Affiche la réponse mot par mot en temps réel
          </p>
        </div>
        <button
          role="switch"
          aria-checked={streamingEnabled}
          onClick={() => setStreamingEnabled(!streamingEnabled)}
          className={`relative w-10 h-5.5 rounded-full transition-colors focus:outline-none
            ${streamingEnabled ? 'bg-brand-500' : 'bg-white/15'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform
              ${streamingEnabled ? 'translate-x-4.5' : 'translate-x-0'}`}
          />
        </button>
      </div>
    </div>
  );
}
