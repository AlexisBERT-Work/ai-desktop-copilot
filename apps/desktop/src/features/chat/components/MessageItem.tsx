import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { Message } from '@neurodesk/shared-types';
import { ToolCallBadge } from '../../agent/ToolCallBadge';

interface Props {
  message: Message;
  isStreaming: boolean;
}

export function MessageItem({ message, isStreaming }: Props) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  if (isTool) return null; // Tool messages not shown directly

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-brand-600/20 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-sm">✨</span>
        </div>
      )}

      <div className={`max-w-[85%] ${isUser ? 'order-first' : ''}`}>
        {/* User bubble */}
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-brand-600/90 px-4 py-2.5 text-sm text-white">
            {message.content}
          </div>
        ) : (
          /* Assistant markdown */
          <div className="space-y-1">
            <MarkdownContent content={message.content} />
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-brand-400 animate-pulse ml-0.5 rounded-full" />
            )}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {message.toolCalls.map(tc => (
                  <ToolCallBadge key={tc.id} toolName={tc.name} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
                    prose-p:leading-relaxed prose-p:my-1
                    prose-pre:p-0 prose-pre:bg-transparent
                    prose-code:text-brand-300 prose-code:bg-white/5
                    prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                    prose-code:text-xs prose-code:font-mono
                    prose-headings:text-white/90 prose-headings:font-semibold
                    prose-a:text-brand-400 prose-a:no-underline hover:prose-a:underline
                    prose-blockquote:border-brand-600 prose-blockquote:text-white/60">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '');
            const lang = match?.[1] ?? '';
            const code = String(children).replace(/\n$/, '');
            const isBlock = code.includes('\n') || !!lang;

            if (isBlock && lang) {
              return <CodeBlock code={code} lang={lang} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-xl overflow-hidden border border-white/8 my-2">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/8">
        <span className="text-xs text-white/40 font-mono">{lang}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-xs text-white/30 hover:text-white/70 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={lang}
        customStyle={{
          margin: 0,
          padding: '0.75rem',
          background: 'rgba(255,255,255,0.03)',
          fontSize: '0.75rem',
          lineHeight: '1.5',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
