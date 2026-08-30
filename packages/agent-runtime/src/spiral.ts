// Détection de « spirale » : l'utilisateur revient sur la même signature
// d'échec depuis trop longtemps. Logique pure, partagée par l'outil
// detect_spiral et par le SpiralMonitor proactif (qui ne doit pas dépendre
// d'un module d'outil pour son vocabulaire métier).

export interface ActivityEvent {
  at: string; // ISO or epoch ms
  kind?: string | undefined;
  signature: string;
}

export interface SpiralVerdict {
  spiraling: boolean;
  minutesOnTopic: number;
  dominantSignature: string | null;
  repetitions: number;
  failureCount: number;
  reason: string;
  suggestion: string | null;
}

const FAILURE_KINDS = new Set(['test_fail', 'error', 'fail', 'exception', 'panic']);

function toMs(at: string): number {
  // Accept epoch ms as a string of digits, else parse as date.
  if (/^\d+$/.test(at)) return parseInt(at, 10);
  const t = Date.parse(at);
  return Number.isNaN(t) ? NaN : t;
}

// Normalize a signature so near-identical errors/files collapse together.
export function normalizeSignature(sig: string): string {
  return sig
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '0x') // memory addresses
    .replace(/:\d+:\d+/g, '') // line:col
    .replace(/\b\d+\b/g, '#') // bare numbers
    .replace(/\s+/g, ' ')
    .trim();
}

// Pure spiral heuristic (exported for tests).
export function detectSpiral(events: ActivityEvent[], thresholdMinutes: number): SpiralVerdict {
  const valid = events
    .map(e => ({ ...e, ms: toMs(e.at), sig: normalizeSignature(e.signature) }))
    .filter(e => !Number.isNaN(e.ms) && e.sig.length > 0)
    .sort((a, b) => a.ms - b.ms);

  if (valid.length < 3) {
    return {
      spiraling: false,
      minutesOnTopic: 0,
      dominantSignature: null,
      repetitions: valid.length,
      failureCount: 0,
      reason: "Pas assez d'activité pour conclure.",
      suggestion: null,
    };
  }

  // Find the most frequent signature.
  const counts = new Map<string, number>();
  for (const e of valid) counts.set(e.sig, (counts.get(e.sig) ?? 0) + 1);
  const [dominant, repetitions] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

  const onTopic = valid.filter(e => e.sig === dominant);
  const first = onTopic[0]?.ms ?? 0;
  const last = onTopic[onTopic.length - 1]?.ms ?? 0;
  const minutesOnTopic = Math.round((last - first) / 60000);
  const failureCount = onTopic.filter(
    e => e.kind !== undefined && FAILURE_KINDS.has(e.kind),
  ).length;

  // Spiral = same signature dominating, long enough, with repetition (and ideally failures).
  const spiraling =
    minutesOnTopic >= thresholdMinutes && repetitions >= 3 && onTopic.length / valid.length >= 0.5;

  let suggestion: string | null = null;
  let reason: string;
  if (spiraling) {
    reason = `~${minutesOnTopic} min sur le même sujet (« ${dominant} »), ${repetitions} retours${failureCount > 0 ? `, ${failureCount} échec(s)` : ''}.`;
    suggestion =
      failureCount > 0
        ? 'Tu boucles sur la même erreur. Fais une pause de 5 min, puis reviens avec une hypothèse écrite : reformule le problème, isole un cas minimal, ou demande une relecture.'
        : "Tu es sur le même point depuis un moment. Pause courte recommandée, ou change d'angle : note où tu en es et attaque un sous-problème différent.";
  } else {
    reason =
      minutesOnTopic < thresholdMinutes
        ? `Sujet principal « ${dominant} » depuis ~${minutesOnTopic} min (< seuil ${thresholdMinutes}).`
        : 'Activité variée, pas de boucle dominante.';
  }

  return {
    spiraling,
    minutesOnTopic,
    dominantSignature: dominant || null,
    repetitions,
    failureCount,
    reason,
    suggestion,
  };
}
