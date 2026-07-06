import { PressFeedsManager, type PressFeedsBackend } from './PressFeedsManager';
import {
  createPressFeed,
  deletePressFeed,
  listPressFeeds,
  runPressDigestNow,
  updatePressFeed,
} from './pressFeedsAdmin';

/** Backend admin : journaux PARTAGÉS stockés dans Supabase, publiés pour tous. */
const ADMIN_BACKEND: PressFeedsBackend = {
  list: listPressFeeds,
  create: createPressFeed,
  update: updatePressFeed,
  remove: deletePressFeed,
  runNow: runPressDigestNow,
  runLabel: 'Publier maintenant',
  runStartedMsg: 'Publication lancée — les dailys apparaîtront dans une minute environ.',
};

/**
 * Gestion des journaux personnalisés PARTAGÉS (console admin) : les recettes
 * vivent dans Supabase et le poste de référence les publie pour tous les
 * clients. Pour les journaux propres à ce poste, voir MyFeedsPanel.
 */
export function PressFeedsPanel() {
  return <PressFeedsManager backend={ADMIN_BACKEND} />;
}
