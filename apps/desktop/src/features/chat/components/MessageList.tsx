import { useEffect, useRef } from 'react';
import { useChatStore } from '../store/chatStore';
import { MessageItem } from './MessageItem';
import { StreamingIndicator } from './StreamingIndicator';

interface Props {
  conversationId: string;
}

export function MessageList({ conversationId }: Props) {
  const { messages, isStreaming, streamingMessageId } = useChatStore();
  const msgs = messages[conversationId] ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length, isStreaming]);

  if (msgs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-600/20 flex items-center justify-center">
          <span className="text-2xl">✨</span>
        </div>
        <div>
          <p className="text-white/70 font-medium">Comment puis-je vous aider ?</p>
          <p className="text-white/30 text-sm mt-1">
            Posez une question, partagez un fichier, ou demandez-moi d&apos;agir sur votre système.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 selectable">
      {msgs.map(msg => (
        <MessageItem
          key={msg.id}
          message={msg}
          isStreaming={isStreaming && msg.id === streamingMessageId}
        />
      ))}
      {isStreaming && streamingMessageId && msgs.find(m => m.id === streamingMessageId)?.content === '' && (
        <StreamingIndicator />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
