import { ArrowLeft, Newspaper } from 'lucide-react';
import { PressFeedsManager, type PressFeedsBackend } from './PressFeedsManager';
import {
  deleteLocalFeed,
  runLocalPressNow,
  saveLocalFeed,
  useLocalPressStore,
} from './localPress';

/**
 * Backend local : journaux propres à CE poste, stockés et générés par l'agent
 * local. `list` lit l'instantané du store ; `subscribe` suit les events poussés
 * par l'agent après chaque écriture (source de vérité).
 */
const LOCAL_BACKEND: PressFeedsBackend = {
  list: () => Promise.resolve({ items: useLocalPressStore.getState().feeds, error: null }),
  create: (input) => saveLocalFeed(input),
  update: (id, input) => saveLocalFeed({ ...input, id }),
  remove: (id) => deleteLocalFeed(id),
  runNow: runLocalPressNow,
  runLabel: 'Générer maintenant',
  runStartedMsg: 'Génération lancée — tes dailys apparaîtront dans une minute environ.',
  subscribe: (cb) => useLocalPressStore.subscribe((s) => cb(s.feeds)),
};

/**
 * « Mes journaux » — journaux personnalisés de CE poste, accessibles à tout
 * utilisateur (pas de rôle admin). L'agent local les collecte chaque jour à la
 * même heure que la revue de presse (rattrapage au démarrage du PC) et leurs
 * dailys s'ajoutent aux dailys partagées dans le widget.
 */
export function MyFeedsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-white/55
                     transition-all hover:bg-white/5 hover:text-white/90 active:scale-[.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        <Newspaper className="h-4 w-4 text-brand-300" aria-hidden />
        <span className="text-sm font-semibold text-white/90">Mes journaux</span>
        <span className="text-xs text-white/35">
          personnels à ce poste · générés chaque jour par ton agent local
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-5">
        <PressFeedsManager backend={LOCAL_BACKEND} />
      </div>
    </div>
  );
}
