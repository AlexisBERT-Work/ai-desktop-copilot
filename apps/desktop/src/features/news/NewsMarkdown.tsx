import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternal } from '../../shared/openExternal';

/** Rendu Markdown léger pour le corps d'une news (liens, gras, listes…). */
export function NewsMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-invert prose-sm max-w-none prose-p:my-0.5
                 prose-a:text-brand-300 prose-a:font-medium prose-a:underline
                 prose-a:underline-offset-2 prose-strong:text-white/90"
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
                title="Ouvrir l'article officiel dans le navigateur"
                className="cursor-pointer text-brand-300 underline underline-offset-2 hover:text-brand-200"
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
