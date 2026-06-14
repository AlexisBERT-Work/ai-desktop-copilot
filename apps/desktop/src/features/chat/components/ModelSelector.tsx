import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, AlertTriangle } from 'lucide-react';
import { useChatStore, modelVramWarning } from '../store/chatStore';

export function ModelSelector() {
  const { selectedModel, availableModels, setModel, loadModels, modelSizes, vramBytes } = useChatStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { loadModels(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const shortName = (m: string) => m.split(':')[0] ?? m;
  const warningFor = (m: string) => modelVramWarning(modelSizes[m], vramBytes);
  const tip = (w: { modelGb: number; vramGb: number }) =>
    `Ce modèle (~${w.modelGb} Go) dépasse la VRAM de cette machine (${w.vramGb} Go) : `
    + `il débordera sur le CPU et sera nettement plus lent.`;

  const selectedWarning = warningFor(selectedModel);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={selectedWarning ? tip(selectedWarning) : undefined}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs
                   text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
        {shortName(selectedModel)}
        {selectedWarning && <AlertTriangle className="w-3 h-3 text-amber-400" />}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-white/10
                        bg-gray-950/98 shadow-xl py-1 z-50">
          {availableModels.map(m => {
            const w = warningFor(m);
            return (
              <button
                key={m}
                onClick={() => { setModel(m); setOpen(false); }}
                title={w ? tip(w) : undefined}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs
                           text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <span className="font-mono truncate">{m}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {w && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                  {m === selectedModel && <Check className="w-3 h-3 text-brand-400" />}
                </span>
              </button>
            );
          })}
          {vramBytes !== null && (
            <p className="px-3 pt-1.5 pb-1 text-[10px] text-white/25 border-t border-white/5 mt-1">
              <AlertTriangle className="inline w-2.5 h-2.5 text-amber-400 mr-1" />
              = trop lourd pour les {Math.round((vramBytes / 1e9) * 10) / 10} Go de VRAM détectés
            </p>
          )}
        </div>
      )}
    </div>
  );
}
