import { AnimatePresence, motion } from 'framer-motion';
import { useOverlayStore } from './overlayStore';
import { MiniMode } from './MiniMode';
import { ChatWindow } from '../chat/components/ChatWindow';
import { CommandPalette } from './CommandPalette';

const SPRING = { type: 'spring', stiffness: 320, damping: 32 } as const;

export function FloatingOverlay() {
  const { isVisible, mode } = useOverlayStore();

  return (
    <div className="fixed inset-0 flex items-end justify-end p-5 pointer-events-none z-50">
      <AnimatePresence mode="wait">
        {isVisible && (
          <motion.div
            key={mode}
            className="pointer-events-auto"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={SPRING}
          >
            {mode === 'mini' && <MiniMode />}
            {mode === 'chat' && <ChatWindow />}
            {mode === 'command' && <CommandPalette />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
