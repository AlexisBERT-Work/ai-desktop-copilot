import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Cat, Cpu, Shield, Keyboard, Info, AlertTriangle, Zap, Check, Loader2 } from 'lucide-react';
import { useSettingsStore } from './settingsStore';
import { useOverlayStore } from '../overlay/overlayStore';
import { useChatStore } from '../chat/store/chatStore';
import { DEFAULT_PERMISSION_CONFIG } from '@catdesk/shared-types';
import type { RiskLevel } from '@catdesk/shared-types';

type SettingsTab = 'model' | 'security' | 'hotkeys' | 'about';

const RISK_COLORS: Record<RiskLevel, string> = {
  low: 'bg-green-500/15 text-green-400',
  medium: 'bg-yellow-500/15 text-yellow-400',
  high: 'bg-orange-500/15 text-orange-400',
  critical: 'bg-red-500/15 text-red-400',
};

const RISK_DOT: Record<RiskLevel, string> = {
  low: 'bg-green-400',
  medium: 'bg-yellow-400',
  high: 'bg-orange-400',
  critical: 'bg-red-400',
};

// ─── GPU auto-tune (KV cache) ─────────────────────────────────

interface KvCacheStatus {
  current: 'f16' | 'q4_0';
  recommended: 'f16' | 'q4_0';
  managed: boolean;
  vramBytes: number | null;
  modelName: string | null;
  modelBytes: number;
}

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
function KvCacheCard() {
  const [status, setStatus] = useState<KvCacheStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<KvCacheStatus>('get_kv_cache_status'));
    } catch {
      setStatus(null); // Ollama unreachable → hide the card
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const apply = useCallback(async (value: 'f16' | 'q4_0') => {
    setBusy(true);
    setNote(null);
    try {
      const res = await invoke<{ restarted: boolean }>('set_kv_cache_type', { value });
      setNote(res.restarted
        ? 'Appliqué — Ollama redémarré.'
        : 'Enregistré — actif au prochain démarrage de CatDesk.');
      await refresh();
    } catch (e) {
      setNote(`Échec : ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

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
            : `Tu as assez de VRAM : le cache standard f16 est le plus rapide ici (le 4-bit coûterait ~6 % pour rien).`}
          {' '}Reco : <span className="font-medium text-white/80">{KV_LABEL[recommended]}</span>.
        </p>
      )}

      {/* Apply / guidance */}
      {managed ? (
        <div className="flex items-center gap-2">
          <button
            disabled={busy || optimal}
            onClick={() => apply(recommended)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${optimal
                ? 'bg-white/5 text-white/30 cursor-default'
                : 'bg-brand-500/20 text-brand-300 hover:bg-brand-500/30'}`}
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

// ─── Sub-panels ──────────────────────────────────────────────

function ModelTab() {
  const { availableModels } = useChatStore();
  const {
    defaultModel, temperature, maxIterations, streamingEnabled,
    setDefaultModel, setTemperature, setMaxIterations, setStreamingEnabled,
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
            onChange={e => setMaxIterations(Math.max(1, Math.min(25, parseInt(e.target.value, 10) || 1)))}
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

function SecurityTab() {
  const { safeMode, setSafeMode } = useSettingsStore();
  const tools = Object.values(DEFAULT_PERMISSION_CONFIG.tools);

  const byRisk: Record<RiskLevel, typeof tools> = {
    low: tools.filter(t => t.riskLevel === 'low'),
    medium: tools.filter(t => t.riskLevel === 'medium'),
    high: tools.filter(t => t.riskLevel === 'high'),
    critical: tools.filter(t => t.riskLevel === 'critical'),
  };

  return (
    <div className="space-y-5">
      {/* Safe mode toggle */}
      <div className={`flex items-start gap-4 p-4 rounded-xl border transition-colors
        ${safeMode
          ? 'bg-orange-500/8 border-orange-500/25'
          : 'bg-white/3 border-white/8'
        }`}>
        <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${safeMode ? 'text-orange-400' : 'text-white/30'}`} />
        <div className="flex-1">
          <p className="text-sm font-medium text-white/90">Mode sans danger</p>
          <p className="text-xs text-white/45 mt-0.5">
            Bloque automatiquement tous les outils à risque moyen, élevé et critique.
            Seules les opérations de lecture restent autorisées.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={safeMode}
          onClick={() => setSafeMode(!safeMode)}
          className={`relative mt-0.5 w-10 h-5 rounded-full transition-colors focus:outline-none shrink-0
            ${safeMode ? 'bg-orange-500' : 'bg-white/15'}`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
              ${safeMode ? 'left-[22px]' : 'left-0.5'}`}
          />
        </button>
      </div>

      {/* Tools table */}
      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Catalogue des outils ({tools.length} outils)
        </p>
        <div className="space-y-3">
          {(['low', 'medium', 'high', 'critical'] as RiskLevel[]).map(risk => (
            byRisk[risk].length > 0 && (
              <div key={risk}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${RISK_DOT[risk]}`} />
                  <span className="text-xs text-white/35 capitalize">
                    {risk === 'low' ? 'Faible' : risk === 'medium' ? 'Moyen' : risk === 'high' ? 'Élevé' : 'Critique'}
                    {' '}— {byRisk[risk].length} outil{byRisk[risk].length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-0.5 pl-3.5">
                  {byRisk[risk].map(tool => (
                    <div
                      key={tool.name}
                      className={`flex items-center gap-2 py-1.5 px-2.5 rounded-lg
                        ${safeMode && risk !== 'low' ? 'opacity-40' : ''}`}
                    >
                      <code className="text-xs text-white/70 font-mono w-44 shrink-0 truncate">
                        {tool.name}
                      </code>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${RISK_COLORS[risk]}`}>
                        {risk}
                      </span>
                      <span className="text-xs text-white/30 truncate">{tool.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}

function HotkeysTab() {
  const global = [
    { keys: 'Ctrl+Space', action: 'Ouvrir / fermer CatDesk' },
  ];
  const local = [
    { keys: 'Ctrl+K', action: 'Palette de commandes' },
    { keys: 'Ctrl+,', action: 'Ouvrir les paramètres' },
    { keys: 'Ctrl+N', action: 'Nouvelle conversation' },
    { keys: 'Escape', action: 'Fermer l\'overlay' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Global (OS)
        </p>
        <div className="space-y-1">
          {global.map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/3">
              <span className="text-sm text-white/70">{action}</span>
              <Keybind keys={keys} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
          Dans l'interface
        </p>
        <div className="space-y-1">
          {local.map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/3">
              <span className="text-sm text-white/70">{action}</span>
              <Keybind keys={keys} />
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-white/25">
        La personnalisation des raccourcis sera disponible dans une prochaine version.
      </p>
    </div>
  );
}

function Keybind({ keys }: { keys: string }) {
  return (
    <div className="flex items-center gap-1">
      {keys.split('+').map((k, i) => (
        <kbd
          key={i}
          className="px-1.5 py-0.5 text-[11px] font-medium text-white/50 bg-white/8 border border-white/10 rounded"
        >
          {k}
        </kbd>
      ))}
    </div>
  );
}

function AboutTab() {
  const stack = [
    { label: 'Shell', value: 'Tauri 2 + Rust' },
    { label: 'Frontend', value: 'React 19 + TypeScript' },
    { label: 'Agent', value: 'Node.js sidecar' },
    { label: 'LLM', value: 'Ollama (local)' },
    { label: 'OCR', value: 'Tesseract + Python' },
    { label: 'Navigateur', value: 'Playwright headless' },
    { label: 'Mémoire', value: 'LanceDB + SQLite' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-500/20 border border-brand-500/30
                        flex items-center justify-center">
          <Cat className="h-6 w-6 text-brand-300" aria-hidden />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white/90">CatDesk</h3>
          <p className="text-xs text-white/40 mt-0.5">Version 0.1.0 — Local-first AI Desktop Copilot</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">Stack technique</p>
        <div className="grid grid-cols-2 gap-1.5">
          {stack.map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/3">
              <span className="text-xs text-white/40 w-20 shrink-0">{label}</span>
              <span className="text-xs text-white/70">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-1 border-t border-white/5">
        <p className="text-xs text-white/25">
          MIT © 2026 CatDesk Contributors · 100% local, 0% cloud
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────

export function SettingsWindow() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('model');
  const { setMode } = useOverlayStore();

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: 'model', label: 'Modèle', icon: <Cpu className="w-4 h-4" /> },
    { id: 'security', label: 'Sécurité', icon: <Shield className="w-4 h-4" /> },
    { id: 'hotkeys', label: 'Raccourcis', icon: <Keyboard className="w-4 h-4" /> },
    { id: 'about', label: 'À propos', icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <div className="w-[720px] h-[540px] rounded-2xl border border-white/10 bg-gray-950/97
                    shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 shrink-0">
        <h2 className="text-sm font-semibold text-white/90">Paramètres</h2>
        <button
          onClick={() => setMode('chat')}
          className="p-1 rounded-lg hover:bg-white/8 transition-colors"
          aria-label="Fermer"
        >
          <X className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-40 border-r border-white/5 py-2 flex flex-col gap-0.5 px-2 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors
                ${activeTab === tab.id
                  ? 'bg-brand-500/15 text-brand-400'
                  : 'text-white/50 hover:text-white/70 hover:bg-white/5'}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'model' && <ModelTab />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'hotkeys' && <HotkeysTab />}
          {activeTab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
