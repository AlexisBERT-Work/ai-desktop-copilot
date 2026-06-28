import { useOverlayStore } from '../../overlay/overlayStore';
import { useChatStore } from '../../chat/store/chatStore';
import { quickActionIcon } from './quickActionIcons';
import type { WidgetProps } from './types';

interface QuickActionViewProps {
  iconName: unknown;
  query: string;
  onClick: () => void;
  disabled: boolean;
}

/** Rendu pur d'une action rapide (bouton) — sans dépendance au store. */
export function QuickActionView({ iconName, query, onClick, disabled }: QuickActionViewProps) {
  const Icon = quickActionIcon(iconName);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2
                 text-left text-sm text-white/70 transition-colors
                 hover:bg-white/10 hover:text-white/90 disabled:opacity-40"
    >
      <Icon className="h-4 w-4 shrink-0 text-brand-300" />
      <span className="truncate">{query || 'Action'}</span>
    </button>
  );
}

/** Une action rapide : envoie une requête prédéfinie à l'agent. */
export function QuickActionWidget({ widget }: WidgetProps) {
  const { setMode } = useOverlayStore();
  const { sendMessage, activeConversationId } = useChatStore();

  const query = typeof widget.config.query === 'string' ? widget.config.query : '';

  return (
    <QuickActionView
      iconName={widget.config.iconName}
      query={query}
      disabled={!query}
      onClick={() => {
        if (!query) return;
        setMode('chat');
        void sendMessage(query, activeConversationId);
      }}
    />
  );
}
