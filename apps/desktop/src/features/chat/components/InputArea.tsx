import { useState, useRef, useCallback } from 'react';
import { ArrowUp, Paperclip, Camera, Square } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '../store/chatStore';

interface Props {
  conversationId: string;
}

export function InputArea({ conversationId }: Props) {
  const [input, setInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isStreaming } = useChatStore();

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await sendMessage(text, conversationId);
  }, [input, isStreaming, sendMessage, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const paths = files.map(f => f.name).join(', ');
    setInput(prev => `${prev} [Fichiers déposés: ${paths}]`.trim());
  };

  const captureScreen = async () => {
    try {
      await sendMessage('Capture mon écran et décris ce que tu vois.', conversationId);
    } catch {}
  };

  return (
    <div
      className={`border-t border-white/5 px-3 py-3 shrink-0 transition-colors
                  ${isDragging ? 'bg-brand-600/10 border-brand-600/30' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="mb-2 text-center text-xs text-brand-400 py-1">
          Drop files to attach
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Textarea */}
        <div className="flex-1 rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message CatDesk... (Shift+Enter for newline)"
            rows={1}
            className="w-full bg-transparent text-sm text-white placeholder-white/30
                       outline-none resize-none leading-relaxed selectable"
            style={{ minHeight: '24px', maxHeight: '160px' }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mb-0.5">
          <button
            onClick={captureScreen}
            title="Capture screen"
            className="p-2 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
            className="p-2 rounded-lg bg-brand-600 text-white
                       hover:bg-brand-500 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isStreaming ? (
              <Square className="w-4 h-4" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-white/15 mt-2">
        CatDesk uses local AI — your data never leaves this machine.
      </p>
    </div>
  );
}
