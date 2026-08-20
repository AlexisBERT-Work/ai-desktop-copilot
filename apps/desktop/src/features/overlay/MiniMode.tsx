import { useState, useRef } from 'react';
import { Cat, ArrowUp, Expand, BarChart3, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useOverlayStore } from './overlayStore';
import { useChatStore } from '../chat/store/chatStore';
import { useAppearanceStore } from '../appearance/appearanceStore';
import { BUBBLE_DIMENSIONS } from '../appearance/palettes';
import { openDashboardWindow } from '../dashboard/openDashboardWindow';

/** Marge transparente autour du contenu, pour que l'ombre portée ne soit pas
 *  rognée par le bord de la fenêtre (voir useOverlayWindow). */
const SHADOW_MARGIN = 20;

export function MiniMode() {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { setMode } = useOverlayStore();
  const { sendMessage, activeConversationId } = useChatStore();
  const bubbleSize = useAppearanceStore(s => s.bubbleSize);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMode('chat');
    await sendMessage(text, activeConversationId);
  };

  return (
    <motion.div
      className="rounded-2xl border border-white/10 shadow-2xl shadow-black/60
                 backdrop-blur-2xl ring-1 ring-white/5"
      style={{
        width: BUBBLE_DIMENSIONS[bubbleSize].miniW - SHADOW_MARGIN,
        // gray-950 avec l'opacité réglée dans Apparence.
        backgroundColor: 'rgb(3 7 18 / var(--bubble-opacity))',
      }}
      layoutId="overlay-shell"
    >
      {/* Input row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Petit salut du chat à l'ouverture de la bulle. */}
        <motion.span
          className="shrink-0"
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.08 }}
        >
          <Cat className="w-5 h-5 text-brand-400" aria-hidden />
        </motion.span>
        <input
          ref={inputRef}
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === 'Escape') setMode('hidden');
          }}
          placeholder="Ask anything..."
          className="flex-1 bg-transparent text-white placeholder-white/30
                     outline-none text-sm font-medium tracking-[-0.01em]"
        />
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setMode('chat')}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/60
                       hover:bg-white/5 transition-colors"
            title="Expand to chat"
          >
            <Expand className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="p-1.5 rounded-lg bg-brand-600 text-white
                       hover:bg-brand-500 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <QuickActions />
    </motion.div>
  );
}

/** Pied de la bulle : uniquement le lanceur de l'application Marchés & News. */
function QuickActions() {
  return (
    <div className="border-t border-white/5 px-3 py-2">
      {/* Pleine largeur, avec la flèche « ouvre une fenêtre ». */}
      <button
        onClick={() => void openDashboardWindow()}
        title="Ouvrir l'application Marchés & News dans une fenêtre séparée"
        className="group flex w-full items-center gap-2.5 rounded-xl border border-brand-500/30
                   bg-brand-500/10 px-3 py-2.5 text-left
                   hover:border-brand-400/50 hover:bg-brand-500/20 transition-colors"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg
                     bg-brand-500/20 text-brand-300 group-hover:text-brand-200"
        >
          <BarChart3 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-brand-200 group-hover:text-brand-100">
            Ouvrir l&apos;application Marchés &amp; News
          </span>
          <span className="block text-[11px] leading-tight text-white/40">
            Tableau de bord bourse &amp; revue de presse — fenêtre séparée
          </span>
        </span>
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-brand-300/70 transition-transform
                     group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-200"
          aria-hidden
        />
      </button>
    </div>
  );
}
