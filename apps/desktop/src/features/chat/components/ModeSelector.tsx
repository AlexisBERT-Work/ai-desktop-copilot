import { Zap, Feather, Code2 } from 'lucide-react';
import { useChatStore } from '../store/chatStore';

type Mode = 'auto' | 'light' | 'code';

const MODES: { id: Mode; label: string; icon: typeof Zap; title: string }[] = [
  { id: 'auto', label: 'Auto', icon: Zap, title: 'Le routeur choisit : léger pour le trivial, code pour le reste' },
  { id: 'light', label: 'Léger', icon: Feather, title: 'Force le modèle léger (rapide, économe)' },
  { id: 'code', label: 'Code', icon: Code2, title: 'Force le modèle de code (heavy)' },
];

/** Bascule Auto / Léger / Code (heavy) pour le choix du modèle. */
export function ModeSelector() {
  const { modelMode, setModelMode, codeModel, lightModel } = useChatStore();

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
      {MODES.map(({ id, label, icon: Icon, title }) => {
        const active = modelMode === id;
        const tip = id === 'code' ? `${title} — ${codeModel}`
          : id === 'light' ? `${title} — ${lightModel}`
          : title;
        return (
          <button
            key={id}
            onClick={() => setModelMode(id)}
            title={tip}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
              active ? 'bg-brand-600/80 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
