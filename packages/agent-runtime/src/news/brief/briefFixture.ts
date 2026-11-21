import type { Brief } from './briefSchema';

/** Brief d'exemple (format v3) partagé par les tests du rendu. */
export const BRIEF_FIXTURE: Brief = {
  headline: 'Pékin <veut> contrôler l’export des poids de modèles',
  leads: [
    {
      title: 'La Chine prépare un contrôle à l’export des grands modèles',
      facts:
        'Le ministère du Commerce vise 23 technologies, dont les poids au-delà de 10^26 FLOPs & plus.\n\nLa liste couvre aussi les **puces** d’inférence.',
      context: 'Washington restreint déjà l’export des puces Nvidia vers la Chine depuis 2022.',
      uncertain: 'Date d’entrée en vigueur non publiée.',
      sources: [
        { name: 'MOFCOM', url: 'https://mofcom.gov.cn/a', kind: 'primaire' },
        { name: 'The Decoder', url: 'https://the-decoder.com/a', kind: 'presse' },
        { name: 'Piège', url: 'javascript:alert(1)', kind: 'presse' },
      ],
    },
    {
      title: 'Agents IA : le CERT-In signale des intrusions',
      facts:
        'Des agents de plusieurs fournisseurs ont lu des données via des identifiants exposés.',
      context: 'Troisième alerte d’une autorité nationale sur les agents depuis l’été.',
      uncertain: null,
      sources: [{ name: 'TechCrunch', url: 'https://tc.com/b', kind: 'presse' }],
    },
  ],
  trends: [
    {
      kind: 'Benchmarks',
      title: 'Gemini 4 Carbon en tête de LMArena',
      body: '1 512 points Elo, 9 de plus que le précédent record.',
      sources: [{ name: 'LMArena', url: 'https://lmarena.ai/leaderboard', kind: 'primaire' }],
    },
    {
      kind: 'Rivalités',
      title: 'xAI attaque OpenAI pour débauchage',
      body: 'La plainte vise le recrutement de 12 ingénieurs.',
      sources: [{ name: 'The Guardian', url: 'https://theguardian.com/x', kind: 'presse' }],
    },
  ],
  sections: [
    {
      name: 'Sécurité',
      items: [
        {
          title: 'Anthropic durcit l’anti-distillation',
          summary: 'Tokens extraits réduits de 90 à 99 %.',
          url: 'https://ex.com/s',
          source: 'ActuIA',
        },
      ],
    },
    {
      name: 'Modèles & recherche',
      items: [
        {
          title: 'Gemini 4 Argon',
          summary: 'Scores très dépendants du protocole de test.',
          url: 'https://the-decoder.com/c',
          source: 'The Decoder',
        },
      ],
    },
    { name: 'Produits & outils', items: [] },
  ],
  agenda: [{ date: '30 octobre 2026', event: 'Nouvelles conditions commerciales de Meta.' }],
};
