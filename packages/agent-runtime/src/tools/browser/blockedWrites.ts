import type { BlockedWrite } from '../../lib/browserManager';

/** Écritures citées dans le résultat ; au-delà, seulement le total. */
const SHOWN = 5;

/**
 * Ce que le résultat d'un outil navigateur dit des écritures refusées par la
 * lecture seule (vide si rien n'a été refusé). Le message est écrit pour le
 * modèle : sans lui, il croit le formulaire envoyé, ou réessaie en boucle.
 */
export function blockedWritesReport(
  blocked: readonly BlockedWrite[],
  action: 'navigate' | 'interact',
): Record<string, unknown> {
  const n = blocked.length;
  if (n === 0) return {};
  const s = n > 1 ? 's' : '';
  // Une requête `document` refusée, c'est une navigation en POST : un formulaire.
  const formBlocked = blocked.some(b => b.resourceType === 'document');

  let readOnlyNotice: string;
  if (action === 'navigate') {
    readOnlyNotice = `${n} envoi${s} de la page refusé${s} (navigateur en lecture seule) : statistiques ou formulaires, rien n'est parti. La lecture n'est pas gênée.`;
  } else if (formBlocked) {
    readOnlyNotice =
      "Formulaire non envoyé : navigateur en lecture seule. Ne réessaie pas, dis-le à l'utilisateur.";
  } else {
    readOnlyNotice = `Le site a voulu envoyer des données (${n} requête${s} refusée${s}) : navigateur en lecture seule, rien n'est parti. Ne réessaie pas, dis-le à l'utilisateur.`;
  }

  return {
    readOnlyNotice,
    blockedWrites: blocked.slice(0, SHOWN).map(b => `${b.method} ${b.url.slice(0, 200)}`),
    ...(n > SHOWN ? { blockedWritesTotal: n } : {}),
    ...(formBlocked ? { formSubmitted: false } : {}),
  };
}
