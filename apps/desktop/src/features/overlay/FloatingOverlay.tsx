import { AnimatePresence, motion } from 'framer-motion';
import { useOverlayStore } from './overlayStore';
import { MiniMode } from './MiniMode';
import { ChatWindow } from '../chat/components/ChatWindow';
import { CommandPalette } from './CommandPalette';
import { SettingsWindow } from '../settings/SettingsWindow';

const SPRING = { type: 'spring', stiffness: 320, damping: 32 } as const;

export function FloatingOverlay() {
  const { isVisible, mode } = useOverlayStore();

  return (
    <div className="fixed inset-0 flex items-center justify-center p-2 pointer-events-none z-50">
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
            {mode === 'settings' && <SettingsWindow />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
