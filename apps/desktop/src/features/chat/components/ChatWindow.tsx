import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Minimize2, Plus, ChevronDown } from 'lucide-react';
import { useOverlayStore } from '../../overlay/overlayStore';
import { useChatStore } from '../store/chatStore';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { ModelSelector } from './ModelSelector';
import { ModeSelector } from './ModeSelector';

export function ChatWindow() {
  const { hide, setMode } = useOverlayStore();
  const { activeConversationId, newConversation, conversations } = useChatStore();
  const activeConv = conversations.find(c => c.id === activeConversationId);

  return (
    <motion.div
      layoutId="overlay-shell"
      className="w-[700px] h-[620px] flex flex-col rounded-2xl border border-white/10
                 bg-gray-950/97 shadow-2xl shadow-black/70 backdrop-blur-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white/80">
            {activeConv?.title ?? 'CatDesk'}
          </span>
          <ModelSelector />
          <ModeSelector />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={newConversation}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
            title="New conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMode('mini')}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
            title="Minimize"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            onClick={hide}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <MessageList conversationId={activeConversationId} />

      {/* Input */}
      <InputArea conversationId={activeConversationId} />
    </motion.div>
  );
}
