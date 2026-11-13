import type { VoiceVocabulary } from '@catdesk/shared-types';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** « 4 noms, 2 variantes » — ce que Rust a retenu du fichier. */
export function summaryLine(v: Pick<VoiceVocabulary, 'terms' | 'aliases'>): string {
  if (v.terms === 0) return 'Vocabulaire vide : rien n’est corrigé.';
  const variants = v.aliases > 0 ? `, ${plural(v.aliases, 'variante', 'variantes')}` : '';
  return `${plural(v.terms, 'nom', 'noms')}${variants}.`;
}
