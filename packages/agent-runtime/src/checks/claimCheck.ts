/**
 * Contrôles d'après réponse, sans modèle : rien n'entre dans le prompt système,
 * donc aucun coût de latence tant que tout va bien.
 *
 * Ce module traite deux défauts trouvés par le banc de qualité (2026-11-05,
 * docs/AMELIORATIONS.md § 4) :
 * - la réponse VIDE (contenu vide, aucun tool call : sans doute un appel d'outil
 *   mal formé qu'Ollama a avalé), que l'utilisateur prenait pour un silence ;
 * - l'annonce SANS OUTIL : « D'accord, je m'en souviendrai » sans que
 *   `store_memory` ait tourné. Faux, et invisible pour l'utilisateur.
 *
 * Idée reprise de Lingbo-Desk (veille du 17/11, MIT) : on ne copie aucun code,
 * seulement le principe « une action annoncée doit avoir eu lieu ».
 */

/** Ce qu'un outil a donné pendant le run, tel que les contrôles le voient. */
export interface ToolOutcome {
  name: string;
  /** Le résultat RÉEL : un appel refusé ou en échec ne couvre aucune annonce. */
  success: boolean;
  /** Ce que le modèle a lu (sortie nettoyée) : on y cherche les chiffres cités. */
  content: string;
}

export interface UnbackedClaim {
  /** L'action annoncée, en clair (« enregistrer en mémoire »). */
  action: string;
  /** L'extrait de la réponse qui l'annonce. */
  quote: string;
  /** Un seul de ces outils, réussi, suffit à couvrir l'annonce. */
  expected: readonly string[];
}

interface ClaimRule {
  action: string;
  expected: readonly string[];
  /** Annonce sans ambiguïté, quelle que soit la demande. */
  claim: RegExp;
  /**
   * Demande de l'utilisateur qui fait d'un simple acquiescement (« D'accord ! »)
   * une annonce. Sans elle, « je m'en souviens » peut être un vrai rappel.
   */
  request?: RegExp;
  /** Acquiescement compté seulement si `request` a été vue dans la demande. */
  ack?: RegExp;
}

/**
 * Motif borné par des lettres. Le `\b` de JavaScript ne connaît que l'ASCII :
 * « noté » en fin de phrase n'y a pas de frontière de mot, et le motif raterait.
 */
function words(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Début de réponse qui vaut « c'est fait ». */
const GENERIC_ACK = new RegExp(
  "^\\s*(?:d'accord|ok|okay|entendu|compris|c'est fait|très bien|parfait|bien sûr|voilà|noté|bien noté|c'est noté)(?![\\p{L}\\p{N}])",
  'iu',
);

const RULES: readonly ClaimRule[] = [
  {
    action: 'enregistrer en mémoire',
    expected: ['store_memory'],
    claim: words(
      "c'est (?:bien )?noté|je m'en souviendrai|je m'en rappellerai|je vais m'en souvenir" +
        "|je (?:le |la |l')?retiendrai|je (?:l'|le |la )?ai (?:bien )?(?:noté|retenu|mémorisé|enregistré)" +
        "|j'ai (?:bien )?(?:noté|retenu|mémorisé)|(?:enregistré|mémorisé|ajouté|gardé) (?:dans|en|à) (?:ma|la) mémoire" +
        "|je (?:le |la |l')?garde(?:rai)? (?:en tête|en mémoire|à l'esprit)",
    ),
    request: words(
      "souviens[- ]toi|rappelle[- ]toi|retiens|mémorise|n'oublie pas|garde (?:en tête|à l'esprit|ça en tête)|note (?:que|bien|ça)",
    ),
    ack: words("je (?:me|m'en) souviens|je (?:le |la |l')?retiens|je (?:le |la |l')?garde"),
  },
  {
    action: 'créer ou modifier un fichier',
    expected: ['write_file', 'export_document'],
    claim: words(
      "j'ai (?:bien )?(?:créé|écrit|enregistré|sauvegardé|exporté|mis à jour|modifié) (?:le |un |ce |ton |votre |ta |la |les )?(?:fichier|document|texte)" +
        '|(?:fichier|document) a (?:bien )?été (?:bien )?(?:créé|enregistré|sauvegardé|exporté)' +
        '|^[^\\p{L}]*(?:fichier|document) (?:bien )?(?:créé|enregistré|sauvegardé|exporté)' +
        "|je l'ai (?:bien )?(?:enregistré|sauvegardé|écrit|exporté) (?:dans|sous|en)",
    ),
    request: words('enregistre|sauvegarde|crée un fichier|écris dans|exporte'),
    ack: words("c'est (?:enregistré|sauvegardé|exporté)"),
  },
  {
    action: 'programmer une tâche ou un rappel',
    expected: ['schedule_task'],
    claim: words(
      "j'ai (?:bien )?(?:planifié|programmé|créé (?:un|le|ton|votre) rappel|mis en place (?:un|le) rappel)" +
        '|(?:rappel|tâche) a (?:bien )?été (?:bien )?(?:créée?|programmée?|planifiée?|enregistrée?)' +
        '|^[^\\p{L}]*(?:rappel|tâche) (?:bien )?(?:créée?|programmée?|planifiée?|enregistrée?)' +
        '|je (?:te|vous) (?:le )?rappellerai',
    ),
  },
  {
    action: 'copier dans le presse-papiers',
    expected: ['write_clipboard'],
    claim: words(
      '(?:copié|mis|placé) (?:le texte |ça |cela |le tout |la réponse )?(?:dans|au) (?:le |ton |votre )?presse-papiers?' +
        '|presse-papiers? (?:mis à jour|rempli)',
    ),
  },
  {
    action: 'envoyer un message',
    expected: ['send_webhook_message', 'post_tech_news_discord'],
    claim: words(
      "j'ai (?:bien )?(?:envoyé|posté|publié|transmis) (?:le |un |ton |votre |ce |la |l')?(?:message|mail|e-mail|courriel|annonce|revue)" +
        '|(?:message|annonce) a (?:bien )?été (?:bien )?(?:envoyée?|postée?|publiée?)' +
        '|^[^\\p{L}]*(?:message|annonce) (?:bien )?(?:envoyée?|postée?|publiée?)',
    ),
  },
  {
    action: 'modifier la liste de suivi',
    expected: ['add_to_watchlist', 'remove_from_watchlist'],
    claim: words(
      "j'ai (?:bien )?(?:ajouté|retiré|supprimé|enlevé) .{0,40}(?:watchlist|liste de suivi)" +
        '|(?:ajoutée?|retirée?) (?:à|de) (?:ta|votre|la) (?:watchlist|liste de suivi)',
    ),
  },
];

/**
 * Marqueurs d'offre ou d'hypothèse placés AVANT l'annonce dans la même phrase :
 * « si tu veux, je m'en souviendrai » n'affirme rien.
 */
const HYPOTHETICAL_BEFORE = words(
  'si|veux-tu|voulez-vous|souhaites|souhaitez|pourrais|pourrait|peux|pouvez|aurais|devrais|est-ce que',
);

/** Une réponse qui refuse ou dit ne pas avoir fait n'acquiesce pas. */
const NEGATION = words('pas|jamais|rien|impossible|désolée?|ne peux');

function sentences(text: string): string[] {
  return text
    .replace(/[’]/g, "'")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** Première phrase où `re` affirme quelque chose (pas d'hypothèse avant). */
function assertedMatch(text: string, re: RegExp): string | null {
  for (const sentence of sentences(text)) {
    const m = re.exec(sentence);
    if (!m) continue;
    if (HYPOTHETICAL_BEFORE.test(sentence.slice(0, m.index))) continue;
    return sentence;
  }
  return null;
}

function covered(rule: ClaimRule, outcomes: readonly ToolOutcome[]): boolean {
  return outcomes.some(o => o.success && rule.expected.includes(o.name));
}

/**
 * Cherche dans la réponse finale une action annoncée qu'aucun outil n'a faite
 * pendant le run. `outcomes` couvre tout le run : un `store_memory` réussi à
 * l'étape 1 couvre un « c'est noté » à l'étape 2.
 */
export function findUnbackedClaim(
  input: string,
  answer: string,
  outcomes: readonly ToolOutcome[],
): UnbackedClaim | null {
  const request = input.replace(/[’]/g, "'");
  for (const rule of RULES) {
    if (covered(rule, outcomes)) continue;
    let quote = assertedMatch(answer, rule.claim);
    if (
      quote === null &&
      rule.request?.test(request) &&
      !answer.includes('?') &&
      !NEGATION.test(answer)
    ) {
      const first = sentences(answer)[0] ?? '';
      if (GENERIC_ACK.test(first)) quote = first;
      else if (rule.ack) quote = assertedMatch(answer, rule.ack);
    }
    if (quote !== null) {
      return { action: rule.action, quote: clip(quote), expected: rule.expected };
    }
  }
  return null;
}

function clip(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** En tête des messages de contrôle : le modèle ne doit pas les prendre pour l'utilisateur. */
const CHECK_PREFIX = "[Vérification automatique de CatDesk, pas un message de l'utilisateur]";

/** Relance après une annonce sans outil. Courte : chaque token se relit (~1 s les 100). */
export function claimCorrection(claim: UnbackedClaim): string {
  return (
    `${CHECK_PREFIX} Ta réponse annonce « ${claim.quote} » (${claim.action}), ` +
    `mais aucun outil ne l'a fait pendant ce tour (${claim.expected.join(' ou ')}). ` +
    // Pas de phrase toute faite à recopier : « dis que rien n'a été fait » ressortait
    // tel quel, même après un store_memory réussi (banc du 2026-11-20, mem-note).
    "Si la demande le justifie, appelle l'outil maintenant, puis confirme en une phrase ce qui a été fait. " +
    "Sinon, réponds en une phrase sans annoncer d'action."
  );
}

/** Mention ajoutée à la réponse quand la relance n'a pas suffi. */
export function claimNotice(claim: UnbackedClaim): string {
  return `(Vérification : rien n'a été fait pour « ${claim.action} », aucun outil n'a tourné. Redemande-le si besoin.)`;
}

export function isEmptyAnswer(text: string): boolean {
  return text.trim().length === 0;
}

/** Relance après une réponse vide (à température 0, la même requête redonnerait du vide). */
export const EMPTY_ANSWER_CORRECTION =
  `${CHECK_PREFIX} Ta réponse est arrivée vide (appel d'outil peut-être mal formé). ` +
  "Réponds à la demande, ou rappelle l'outil avec des arguments valides.";

/** Ce que voit l'utilisateur si la relance revient vide elle aussi. */
export const EMPTY_ANSWER_MESSAGE =
  "Je n'ai pas réussi à répondre cette fois : le modèle a renvoyé une réponse vide. " +
  'Reformule ta demande ou réessaie.';
