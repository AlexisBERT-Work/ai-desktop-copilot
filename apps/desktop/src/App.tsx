import { FloatingOverlay } from './features/overlay/FloatingOverlay';
import { PermissionPrompt } from './features/agent/PermissionPrompt';
import { ProactiveBanner } from './features/proactive/ProactiveBanner';
import { useHotkeys } from './shared/hooks/useHotkeys';
import { useTauriEvents } from './shared/hooks/useTauriEvents';
import { useOverlayWindow } from './shared/hooks/useOverlayWindow';

export default function App() {
  useHotkeys();
  useTauriEvents();
  useOverlayWindow();

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <FloatingOverlay />
      <PermissionPrompt />
      <ProactiveBanner />
    </div>
  );
}
