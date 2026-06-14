import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore, type AgentStatus } from '../store/chatStore';

/** Petit texte d'état affiché sous le fil de discussion. */
export function StatusIndicator() {
  const status = useChatStore(s => s.status);
  const activeTool = useChatStore(s => s.activeTool);

  if (status === 'idle') return null;

  const animated = status === 'thinking' || status === 'responding' || status === 'tool';
  const label = statusLabel(status, activeTool);
  const color =
    status === 'error' ? 'text-red-400'
    : status === 'interrupted' ? 'text-amber-400/80'
    : 'text-white/40';

  return (
    <AnimatePresence>
      <motion.div
        key={`${status}:${activeTool ?? ''}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className={`flex items-center gap-1.5 px-4 py-1 text-xs ${color}`}
      >
        {animated && (
          <span className="flex gap-0.5">
            {[0, 1, 2].map(i => (
              <motion.span
                key={i}
                className="inline-block w-1 h-1 rounded-full bg-current"
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </span>
        )}
        <span>{label}</span>
      </motion.div>
    </AnimatePresence>
  );
}

function statusLabel(status: AgentStatus, activeTool: string | null): string {
  switch (status) {
    case 'thinking': return 'CatDesk réfléchit';
    case 'responding': return 'CatDesk écrit';
    case 'tool': return `Utilise ${prettyTool(activeTool)}`;
    case 'interrupted': return 'Interrompu';
    case 'error': return "Une erreur s'est produite";
    default: return '';
  }
}

function prettyTool(name: string | null): string {
  if (!name) return 'un outil';
  return name.replace(/_/g, ' ');
}
