import { useOverlayStore } from '../../overlay/overlayStore';
import { useChatStore } from '../../chat/store/chatStore';
import type { WidgetProps } from './types';

/** Une action rapide : envoie une requête prédéfinie à l'agent et ouvre le chat. */
export function QuickActionWidget({ widget }: WidgetProps) {
  const { setMode } = useOverlayStore();
  const { sendMessage, activeConversationId } = useChatStore();

  const icon = typeof widget.config.icon === 'string' ? widget.config.icon : '⚡';
  const query = typeof widget.config.query === 'string' ? widget.config.query : '';

  return (
    <button
      onClick={async () => {
        if (!query) return;
        setMode('chat');
        await sendMessage(query, activeConversationId);
      }}
      disabled={!query}
      className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2
                 text-left text-sm text-white/70 transition-colors
                 hover:bg-white/10 hover:text-white/90 disabled:opacity-40"
    >
      <span className="text-lg">{icon}</span>
      <span className="truncate">{query || 'Action'}</span>
    </button>
  );
}
