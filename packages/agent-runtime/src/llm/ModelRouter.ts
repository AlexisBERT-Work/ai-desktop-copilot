/**
 * Routeur de modèles : choisit un modèle Ollama selon la complexité estimée de
 * la tâche, pour économiser les ressources (un petit modèle rapide pour les cas
 * simples, le gros modèle quand c'est nécessaire).
 *
 * Heuristique simple et explicable. Utilisé en mode « downgrade-only » par
 * l'orchestrateur : `large` vaut le modèle choisi par l'utilisateur, et on ne
 * rétrograde vers `small` que pour les tâches manifestement triviales.
 *
 * ⚠️ **INERTE PAR DÉFAUT DEPUIS v0.1.3.** Le bundle n'embarque plus qu'un seul
 * modèle de chat (`qwen3:14b`, cf. CLAUDE.md) : `light` est donc absent, et
 * `resolveModel` sort systématiquement sur « Auto : modèle principal » sans
 * jamais construire de ModelRouter. Les trois familles de regex ci-dessous ne
 * s'évaluent QUE si l'utilisateur pose `CATDESK_MODEL_SMALL` à la main.
 * Ce n'est pas un bug — le garde-fou reste correct et le jour où un second
 * palier revient, tout se rebranche seul. À lire en connaissant cet état, sinon
 * on croit à tort que le routage est actif en production.
 */

export interface ModelRouterConfig {
  /** Modèle léger/rapide (ex. 'qwen2.5:7b'). */
  small: string;
  /** Modèle principal/puissant (ex. 'qwen2.5:14b'). */
  large: string;
  /** Seuil de longueur (caractères) au-delà duquel on passe au gros modèle. */
  lengthThreshold?: number;
}

export interface RouteInput {
  /** Texte de la requête utilisateur. */
  prompt: string;
  /** La tâche implique-t-elle des outils (souvent = raisonnement multi-étapes) ? */
  usesTools?: boolean;
  /** Forcer un modèle précis (court-circuite l'heuristique). */
  forceModel?: string;
}

export interface RouteDecision {
  model: string;
  tier: 'small' | 'large' | 'forced';
  reason: string;
}

// Indices d'une tâche « lourde » justifiant le gros modèle.
const COMPLEX_HINTS = [
  /\b(analyse|analyser|refactor|architecture|con[çc]ois|conception|debug|d[ée]bogu|expliqu|raisonne|compare|strat[ée]gie|plan|optimise)\b/i,
  /\b(why|how|design|implement|complex|reasoning|step.?by.?step)\b/i,
  /```/, // contient un bloc de code
];

// Indices d'une requête d'ACTION (impératif orienté-outil) : capturer l'écran,
// ouvrir/lire un fichier, cliquer, envoyer un message… Même courtes, ces tâches
// déclenchent un outil et exigent (a) un appel d'outil fiable et (b) une narration
// correcte — deux choses que le petit modèle rate (français cassé, outil annoncé
// en texte au lieu d'être appelé). On les garde donc sur le gros modèle plutôt que
// de les rétrograder comme de simples « tâches courtes ».
const ACTION_HINTS = [
  /\b(captur|screenshot|d[ée]cri|montre|affiche|vois[ -]?tu|que vois|[àa] l.?[ée]cran|screen)/i,
  /\b(ouvr|lance|d[ée]marr|ex[ée]cut|ferme|clique|tape|saisi|appuie)/i,
  /\b(lis|lire|[ée]cri|r[ée]dige|envoi|envoy|publi|poste|partage|transcri)/i,
  /\b(cherch|recherch|trouve|t[ée]l[ée]charg|enregistre|sauvegarde|supprim|d[ée]plac|renomme|cr[ée]e)/i,
  /\b(open|launch|run|click|read|write|send|search|download|delete|describe|show|capture)\b/i,
];

// Questions sur l'actu / les articles / les dailys : mission première du bot.
// Elles déclenchent search_dailies puis une synthèse filtrée — exactement ce
// que le petit modèle rate (outil annoncé en texte, déballage de toute la
// daily au lieu de répondre à la question). Jamais de rétrogradation ici.
const RESEARCH_HINTS = [
  /\b(news|actus?|actualit[ée]s?|articles?|dailys?|dailies|journa(l|ux)|presse|revues?|headlines?)\b/i,
  /\bquoi de neuf\b/i,
];

export class ModelRouter {
  private readonly small: string;
  private readonly large: string;
  private readonly lengthThreshold: number;

  constructor(config: ModelRouterConfig) {
    this.small = config.small;
    this.large = config.large;
    this.lengthThreshold = config.lengthThreshold ?? 280;
  }

  route(input: RouteInput): RouteDecision {
    if (input.forceModel) {
      return { model: input.forceModel, tier: 'forced', reason: 'Modèle forcé par la requête' };
    }

    const prompt = input.prompt ?? '';

    // NB : la simple disponibilité d'outils ne justifie PAS le gros modèle —
    // les outils sont toujours exposés, donc escalader là-dessus enverrait
    // chaque requête (même triviale) sur le modèle lourd. On route uniquement
    // sur la complexité réelle du prompt.
    if (prompt.length > this.lengthThreshold) {
      return {
        model: this.large,
        tier: 'large',
        reason: `Requête longue (>${this.lengthThreshold} car.)`,
      };
    }
    if (COMPLEX_HINTS.some(re => re.test(prompt))) {
      return { model: this.large, tier: 'large', reason: 'Indices de tâche complexe détectés' };
    }
    if (ACTION_HINTS.some(re => re.test(prompt))) {
      return {
        model: this.large,
        tier: 'large',
        reason: "Requête d'action orientée-outil (pas de rétrogradation)",
      };
    }
    if (RESEARCH_HINTS.some(re => re.test(prompt))) {
      return {
        model: this.large,
        tier: 'large',
        reason: 'Question actu/articles (pas de rétrogradation)',
      };
    }

    return { model: this.small, tier: 'small', reason: 'Tâche simple/courte → modèle rapide' };
  }
}

export type ModelMode = 'auto' | 'light' | 'code';

export interface ResolveModelInput {
  mode: ModelMode;
  /** Modèle demandé/par défaut (fallback). */
  requested: string;
  /** Modèle léger (mode 'light' + borne basse de 'auto'). */
  light?: string;
  /** Modèle de code/heavy (mode 'code' + borne haute de 'auto'). */
  code?: string;
  input: string;
  usesTools: boolean;
}

/**
 * Résout le modèle effectif selon le mode :
 * - 'light' / 'code' : forçage explicite (avec repli sur `requested`)
 * - 'auto' : routage `small=light` / `large=code|requested` via ModelRouter.
 */
export function resolveModel(i: ResolveModelInput): RouteDecision {
  if (i.mode === 'light') {
    return {
      model: i.light ?? i.requested,
      tier: i.light ? 'small' : 'forced',
      reason: 'Mode léger forcé',
    };
  }
  if (i.mode === 'code') {
    return {
      model: i.code ?? i.requested,
      tier: i.code ? 'large' : 'forced',
      reason: 'Mode code (heavy) forcé',
    };
  }
  // auto : la borne haute est le modèle principal demandé (ex. qwen2.5:7b),
  // PAS le modèle de code lourd — celui-ci ne sert qu'en mode 'code' explicite.
  // Escalader vers le 14B en auto rendait chaque requête lente (il déborde de
  // la VRAM). On ne fait donc plus que de l'éventuelle rétrogradation vers
  // `light` pour les tâches triviales.
  const large = i.requested;
  if (!i.light || i.light === large) {
    return { model: large, tier: 'large', reason: 'Auto : modèle principal' };
  }
  return new ModelRouter({ small: i.light, large }).route({
    prompt: i.input,
    usesTools: i.usesTools,
  });
}
