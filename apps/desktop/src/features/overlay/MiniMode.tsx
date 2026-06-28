import { useState, useRef } from 'react';
import { Sparkles, ArrowUp, Expand } from 'lucide-react';
import { motion } from 'framer-motion';
import { useOverlayStore } from './overlayStore';
import { useChatStore } from '../chat/store/chatStore';

export function MiniMode() {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { setMode } = useOverlayStore();
  const { sendMessage, activeConversationId } = useChatStore();

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMode('chat');
    await sendMessage(text, activeConversationId);
  };

  return (
    <motion.div
      className="w-[580px] rounded-2xl border border-white/10 bg-gray-950/96
                 shadow-2xl shadow-black/60 backdrop-blur-2xl ring-1 ring-white/5"
      layoutId="overlay-shell"
    >
      {/* Input row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Sparkles className="w-5 h-5 text-brand-400 shrink-0" />
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

function QuickActions() {
  const { setMode } = useOverlayStore();

  const actions = [
    { label: 'Screenshot & analyze', icon: '📸', query: 'Capture my screen and tell me what you see' },
    { label: 'Read clipboard', icon: '📋', query: 'Read my clipboard and summarize it' },
    { label: 'Run command', icon: '⚡', query: 'Run a PowerShell command for me' },
  ];

  const { sendMessage, activeConversationId } = useChatStore();

  return (
    <div className="border-t border-white/5 px-3 py-2 flex gap-1.5 flex-wrap">
      <button
        onClick={() => setMode('dashboard')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                   text-xs text-brand-300 hover:text-brand-200
                   bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
      >
        <span>📊</span>
        Tableau de bord
      </button>
      {actions.map(action => (
        <button
          key={action.label}
          onClick={async () => {
            setMode('chat');
            await sendMessage(action.query, activeConversationId);
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                     text-xs text-white/50 hover:text-white/80
                     bg-white/5 hover:bg-white/10 transition-colors"
        >
          <span>{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>
  );
}
