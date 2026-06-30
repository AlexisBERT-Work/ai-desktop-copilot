import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternal } from '../../shared/openExternal';

/** Rendu Markdown léger pour le corps d'une news (liens, gras, listes…). */
export function NewsMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-invert prose-sm max-w-none prose-p:my-0.5
                 prose-a:text-brand-300 prose-a:no-underline hover:prose-a:underline
                 prose-strong:text-white/90"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Les liens d'articles ouvrent le navigateur externe : la fenêtre de
          // l'app ne navigue jamais (sinon on reste coincé sans bouton retour).
          a({ href, children }) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
