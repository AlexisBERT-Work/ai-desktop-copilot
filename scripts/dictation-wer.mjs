#!/usr/bin/env node
// Mesure de la dictée (Ctrl+Alt+Espace) : taux d'erreur par mot et latence.
//
// Séance au micro, dans chaque application testée (Bloc-notes, Word, Edge…) :
//   1. node scripts/dictation-wer.mjs --sheet      → les 20 phrases à lire
//   2. dicter chaque phrase (touche maintenue), puis Entrée À LA MAIN (la
//      dictée ne tape jamais de retour à la ligne) ; enregistrer en .txt
//   3. node scripts/dictation-wer.mjs notepad.txt   → WER par phrase et total
//   4. node scripts/dictation-wer.mjs --audit       → latence relâchement →
//      texte, lue dans le journal d'audit (VOICE_DICTATE, jamais le texte)
//
// Cibles (docs/AMELIORATIONS.md, piste 4) : WER < 8 %, < 800 ms pour 5 s de
// parole, presse-papier intact. Aucune dépendance, rien ne sort de la machine.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pas de chiffres : « quinze » ou « 15 » compteraient comme une erreur.
export const PHRASES = [
  'Bonjour, je serai en retard de quelques minutes à la réunion de ce matin.',
  "Peux-tu m'envoyer le compte rendu avant la fin de la journée ?",
  'Le rapport trimestriel montre une hausse des ventes en Bretagne.',
  "N'oublie pas d'acheter du pain, des œufs et du fromage.",
  "Je te rappelle dès que j'ai fini de déjeuner.",
  'La facture doit être réglée avant la fin du mois prochain.',
  "Merci beaucoup pour ton aide, c'était vraiment précieux.",
  'Nous avons rendez-vous chez le dentiste jeudi après-midi.',
  'Le train pour Marseille part de la gare de Lyon à Paris.',
  "Il faudrait revoir la présentation avant de l'envoyer au client.",
  'Quelle est la meilleure façon de configurer le pare-feu ?',
  "J'ai réservé une table pour toute la famille au restaurant.",
  'Le chat dort sur le canapé depuis ce matin.',
  'Pourrais-tu relire ce paragraphe et corriger les fautes ?',
  'La météo annonce de la pluie et du vent pour tout le week-end.',
  "Je suis d'accord avec ta proposition, on peut commencer lundi.",
  "Les enfants rentrent de l'école en fin d'après-midi.",
  "Envoie-moi l'adresse exacte, je viendrai en voiture.",
  'Cette application tourne entièrement sur mon ordinateur.',
  "À bientôt, et bonne fin de semaine à toute l'équipe.",
];

/** Mots comparables : minuscules, apostrophes et tirets séparent, ponctuation ignorée. */
export function words(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Distance d'édition (substitutions + insertions + suppressions) entre deux suites de mots. */
export function editDistance(ref, hyp) {
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[hyp.length];
}

function median(values) {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function score(file) {
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length !== PHRASES.length) {
    console.warn(`! ${lines.length} lignes pour ${PHRASES.length} phrases : alignement ligne à ligne`);
  }
  let errors = 0;
  let total = 0;
  PHRASES.forEach((ref, i) => {
    const r = words(ref);
    const h = words(lines[i] ?? '');
    const e = editDistance(r, h);
    errors += e;
    total += r.length;
    const mark = e === 0 ? 'ok ' : `${e}  `;
    console.log(`${String(i + 1).padStart(2)} ${mark} ${e === 0 ? '' : `→ ${lines[i] ?? '(absente)'}`}`);
  });
  const wer = (100 * errors) / total;
  console.log(`\nWER ${wer.toFixed(1)} % (${errors} erreurs sur ${total} mots) — cible < 8 %`);
}

function auditDir() {
  if (process.env.CATDESK_DATA_DIR) return join(process.env.CATDESK_DATA_DIR, 'audit');
  return join(process.env.APPDATA ?? '.', 'com.catdesk.app', 'agent-data', 'audit');
}

function audit(path) {
  const dir = path ?? auditDir();
  const files = path?.endsWith('.log')
    ? [path]
    : readdirSync(dir)
        .filter(f => /^audit-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .sort()
        .slice(-1)
        .map(f => join(dir, f));
  const entries = files
    .flatMap(f => readFileSync(f, 'utf8').split('\n'))
    .filter(l => l.includes('"VOICE_DICTATE"'))
    .map(l => JSON.parse(l));
  if (entries.length === 0) {
    console.log(`Aucune dictée dans ${files.join(', ') || dir}`);
    return;
  }
  const outcomes = {};
  for (const e of entries) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
  const inserted = entries.filter(e => e.outcome === 'inserted');
  // Ramené à 5 s de parole : l'unité de la cible.
  const per5s = inserted.filter(e => e.audioMs > 0).map(e => (e.ms * 5000) / e.audioMs);
  console.log(`${entries.length} dictées : ${JSON.stringify(outcomes)}`);
  console.log(
    `relâchement → texte : médiane ${median(inserted.map(e => e.ms))} ms` +
      ` (STT ${median(inserted.map(e => e.sttMs))} ms, attente Ctrl/Alt ${median(inserted.map(e => e.waitMs))} ms)`,
  );
  console.log(`ramené à 5 s de parole : médiane ${Math.round(median(per5s))} ms — cible < 800 ms`);
}

const [arg, extra] = process.argv.slice(2);
if (arg === '--sheet') {
  PHRASES.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${p}`));
} else if (arg === '--audit') {
  audit(extra);
} else if (arg) {
  score(arg);
} else {
  console.log('Usage : --sheet | <fichier.txt dicté> | --audit [dossier ou audit-AAAA-MM-JJ.log]');
}
