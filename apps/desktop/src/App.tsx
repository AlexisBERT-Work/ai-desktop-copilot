import { FloatingOverlay } from './features/overlay/FloatingOverlay';
import { PermissionPrompt } from './features/agent/PermissionPrompt';
import { ProactiveBanner } from './features/proactive/ProactiveBanner';
import { NewsBanner } from './features/news/NewsBanner';
import { useNews } from './features/news/useNews';
import { useAppearance } from './features/appearance/useAppearance';
import { useHotkeys } from './shared/hooks/useHotkeys';
import { useTauriEvents } from './shared/hooks/useTauriEvents';
import { useOverlayWindow } from './shared/hooks/useOverlayWindow';

export default function App() {
  useHotkeys();
  useTauriEvents();
  useOverlayWindow();
  // Accent et opacité de la bulle ; la mise à l'échelle du texte est réservée
  // au tableau de bord (la bulle a un gabarit fixe — voir « Taille de la bulle »).
  useAppearance('overlay');
  useNews();

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <FloatingOverlay />
      <PermissionPrompt />
      <ProactiveBanner />
      <NewsBanner />
    </div>
  );
}
