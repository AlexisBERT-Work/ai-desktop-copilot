import { useState } from 'react';
import { ArrowLeft, Laptop, LogOut, Newspaper, Users } from 'lucide-react';
import { isNewsConfigured as isSupabaseConfigured } from '../news/supabaseClient';
import { useAdminSession, signOutAdmin } from './adminAuth';
import { AdminLogin } from './DailiesAdminConsole';
import { PressFeedsManager, type PressFeedsBackend } from './PressFeedsManager';
import { PressFeedsPanel } from './PressFeedsPanel';
import { PressRunStatusBanner } from './PressRunStatusBanner';
import { deleteLocalFeed, runLocalPressNow, saveLocalFeed, useLocalPressStore } from './localPress';

/**
 * Backend local : journaux propres à CE poste, stockés et générés par l'agent
 * local. `list` lit l'instantané du store ; `subscribe` suit les events poussés
 * par l'agent après chaque écriture (source de vérité).
 */
const LOCAL_BACKEND: PressFeedsBackend = {
  list: () => Promise.resolve({ items: useLocalPressStore.getState().feeds, error: null }),
  create: input => saveLocalFeed(input),
  update: (id, input) => saveLocalFeed({ ...input, id }),
  remove: id => deleteLocalFeed(id),
  runNow: runLocalPressNow,
  runLabel: 'Générer maintenant',
  runStartedMsg: 'Génération lancée — tes dailys apparaîtront dans une minute environ.',
  subscribe: cb => useLocalPressStore.subscribe(s => cb(s.feeds)),
};

type FeedScope = 'local' | 'shared';

/**
 * « Journaux » — l'UNIQUE écran de gestion des journaux, quelle que soit leur
 * portée (même métier, une seule interface) :
 * - « Ce poste » : journaux personnels, générés par l'agent local (tout
 *   utilisateur, aucun compte) ;
 * - « Partagés (tous) » : journaux publiés pour tous les utilisateurs par le
 *   poste de référence — visible seulement si Supabase est configuré, et
 *   verrouillé par la connexion admin.
 * La rédaction des dailys manuelles reste dans la console Admin (métier
 * distinct : écrire, pas configurer).
 */
export function MyFeedsPanel({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<FeedScope>('local');

  const scopeClass = (on: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      on ? 'bg-brand-600 text-white' : 'text-white/55 hover:bg-white/10 hover:text-white/85'
    }`;

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
        <span className="text-sm font-semibold text-white/90">Journaux</span>
        <span className="text-xs text-white/35">
          {scope === 'local'
            ? 'personnels à ce poste · générés chaque jour par ton agent local'
            : 'publiés pour TOUS les utilisateurs par le poste de référence'}
        </span>
      </header>

      {scope === 'local' && <PressRunStatusBanner />}

      <div className="flex-1 overflow-y-auto p-5">
        {isSupabaseConfigured && (
          <div className="mb-4 flex items-center gap-2">
            <button className={scopeClass(scope === 'local')} onClick={() => setScope('local')}>
              <Laptop className="h-4 w-4" aria-hidden />
              Ce poste
            </button>
            <button className={scopeClass(scope === 'shared')} onClick={() => setScope('shared')}>
              <Users className="h-4 w-4" aria-hidden />
              Partagés (tous)
            </button>
          </div>
        )}

        {scope === 'local' ? <PressFeedsManager backend={LOCAL_BACKEND} /> : <SharedFeeds />}
      </div>
    </div>
  );
}

/** Portée « Partagés » : verrouillée par la session admin (RLS côté serveur en plus). */
function SharedFeeds() {
  const { loading, isAdmin, email } = useAdminSession();

  if (loading) return <p className="text-sm text-white/40">Chargement…</p>;
  if (!isAdmin) return <AdminLogin />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-white/40">
        <span>
          Connecté : <span className="text-white/60">{email}</span> — ces journaux sont publiés pour
          tous les utilisateurs.
        </span>
        <button
          onClick={() => void signOutAdmin()}
          className="flex items-center gap-1 text-white/55 hover:text-white/85"
        >
          <LogOut className="h-3.5 w-3.5" />
          Déconnexion
        </button>
      </div>
      <PressFeedsPanel />
    </div>
  );
}
