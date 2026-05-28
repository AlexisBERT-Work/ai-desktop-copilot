import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useChatStore } from '../store/chatStore';

export function ModelSelector() {
  const { selectedModel, availableModels, setModel, loadModels } = useChatStore();
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs
                   text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
        {shortName(selectedModel)}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 rounded-xl border border-white/10
                        bg-gray-950/98 shadow-xl py-1 z-50">
          {availableModels.map(m => (
            <button
              key={m}
              onClick={() => { setModel(m); setOpen(false); }}
              className="w-full flex items-center justify-between px-3 py-2 text-xs
                         text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="font-mono">{m}</span>
              {m === selectedModel && <Check className="w-3 h-3 text-brand-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
