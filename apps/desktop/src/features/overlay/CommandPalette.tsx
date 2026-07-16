import { useState, useMemo, useCallback } from 'react';
import {
  Search,
  Terminal,
  FileText,
  Camera,
  Clipboard,
  Settings,
  LayoutDashboard,
  X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useOverlayStore } from './overlayStore';
import { useChatStore } from '../chat/store/chatStore';
import { openDashboardWindow } from '../dashboard/openDashboardWindow';

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const { setMode } = useOverlayStore();
  const { sendMessage, activeConversationId } = useChatStore();
  const [selected, setSelected] = useState(0);

  const sendAndExpand = useCallback(
    async (text: string) => {
      setMode('chat');
      await sendMessage(text, activeConversationId);
    },
    [setMode, sendMessage, activeConversationId],
  );

  // Mémoïsé : sinon le tableau serait recréé à chaque render et invaliderait
  // le useMemo `filtered` (c'était la cause du warning exhaustive-deps).
  const commands: Command[] = useMemo(
    () => [
      {
        id: 'screenshot',
        label: 'Capture & analyze screen',
        description: "Take a screenshot and describe what's on screen",
        icon: <Camera className="w-4 h-4" />,
        action: () => sendAndExpand('Capture mon écran et décris ce que tu vois en détail.'),
      },
      {
        id: 'clipboard',
        label: 'Analyze clipboard',
        description: 'Read and summarize clipboard content',
        icon: <Clipboard className="w-4 h-4" />,
        action: () => sendAndExpand('Lis mon presse-papier et résume ou améliore le contenu.'),
      },
      {
        id: 'run-cmd',
        label: 'Run a command',
        description: 'Execute PowerShell or CMD',
        icon: <Terminal className="w-4 h-4" />,
        action: () => sendAndExpand('Je veux exécuter une commande. Aide-moi.'),
      },
      {
        id: 'file',
        label: 'Analyze a file',
        description: 'Open and analyze a document',
        icon: <FileText className="w-4 h-4" />,
        action: () => sendAndExpand('Analyse un fichier pour moi.'),
      },
      {
        id: 'dashboard',
        label: 'Marchés & News',
        description: 'Open the markets & news dashboard (separate window)',
        icon: <LayoutDashboard className="w-4 h-4" />,
        action: () => void openDashboardWindow(),
      },
      {
        id: 'settings',
        label: 'Open settings',
        description: 'Configure models, permissions, and hotkeys',
        icon: <Settings className="w-4 h-4" />,
        action: () => setMode('settings'),
      },
    ],
    [sendAndExpand, setMode],
  );

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      c => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [query, commands]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      filtered[selected]?.action();
    } else if (e.key === 'Escape') {
      setMode('hidden');
    }
  };

  return (
    <motion.div
      className="w-[620px] rounded-2xl border border-white/10 bg-gray-950/97
                 shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden"
      layoutId="overlay-shell"
    >
      {/* Search */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
        <Search className="w-4 h-4 text-white/40 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search commands..."
          className="flex-1 bg-transparent text-white placeholder-white/30 outline-none text-sm"
        />
        <button onClick={() => setMode('hidden')}>
          <X className="w-4 h-4 text-white/30 hover:text-white/60 transition-colors" />
        </button>
      </div>

      {/* Results */}
      <div className="py-1.5 max-h-80 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-white/30">No commands found</p>
        ) : (
          filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={cmd.action}
              onMouseEnter={() => setSelected(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left
                         transition-colors ${i === selected ? 'bg-white/8' : 'hover:bg-white/5'}`}
            >
              <span
                className={`p-1.5 rounded-lg ${i === selected ? 'text-brand-400 bg-brand-400/10' : 'text-white/40 bg-white/5'}`}
              >
                {cmd.icon}
              </span>
              <div>
                <p className="text-sm font-medium text-white/90">{cmd.label}</p>
                <p className="text-xs text-white/40">{cmd.description}</p>
              </div>
              {i === selected && (
                <kbd className="ml-auto text-xs text-white/20 bg-white/5 px-1.5 py-0.5 rounded">
                  ↵
                </kbd>
              )}
            </button>
          ))
        )}
      </div>
    </motion.div>
  );
}
