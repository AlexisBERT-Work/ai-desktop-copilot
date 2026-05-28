import { useEffect } from 'react';
import { FloatingOverlay } from './features/overlay/FloatingOverlay';
import { PermissionPrompt } from './features/agent/PermissionPrompt';
import { useHotkeys } from './shared/hooks/useHotkeys';
import { useOverlayStore } from './features/overlay/overlayStore';
import { useTauriEvents } from './shared/hooks/useTauriEvents';

export default function App() {
  useHotkeys();
  useTauriEvents();

  const { mode } = useOverlayStore();

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <FloatingOverlay />
      <PermissionPrompt />
    </div>
  );
}
