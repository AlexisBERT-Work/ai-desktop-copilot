import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight } from 'lucide-react';
import { openExternal } from '../../shared/openExternal';

/**
 * Convention des corps de news : un blockquote est le détail d'un article
 * (rédigé par le LLM sous chaque puce) — on le replie derrière « En savoir
 * plus » pour garder la liste dense, le lien de la puce restant le chemin
 * vers l'article complet.
 */
function CollapsibleDetail({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-0.5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-0.5 text-[11px] font-medium text-brand-300 hover:text-brand-200"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        {open ? 'Réduire' : 'En savoir plus'}
      </button>
      {open && (
        <div className="mt-1 animate-slide-up border-l-2 border-brand-400/30 pl-2 text-white/70">
          {children}
        </div>
      )}
    </div>
  );
}

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
                onClick={e => {
                  e.preventDefault();
                  openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return <CollapsibleDetail>{children}</CollapsibleDetail>;
          },
          // Chaque puce est UN article (convention des corps de dailys) : on la
          // rend comme un bloc bordé distinct — sans séparation, les articles
          // se fondaient en un seul pavé illisible.
          ul({ children }) {
            return <ul className="my-1 list-none space-y-1.5 pl-0">{children}</ul>;
          },
          li({ children }) {
            return (
              <li className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
                {children}
              </li>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
