import type { Brief } from './briefSchema';

/** Brief d'exemple (format v2) partagé par les tests du rendu. */
export const BRIEF_FIXTURE: Brief = {
  headline: 'Pékin <veut> contrôler l’export des poids de modèles',
  leads: [
    {
      title: 'La Chine prépare un contrôle à l’export des grands modèles',
      facts:
        'Le ministère du Commerce vise 23 technologies, dont les poids au-delà de 10^26 FLOPs & plus.',
      forUs:
        'Les modèles ouverts chinois hébergés en interne deviennent un **risque** de continuité.',
      action: 'Recenser les modèles chinois hébergés et désigner un modèle de repli.',
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
      forUs: 'L’hygiène des secrets devient prioritaire pour les données cliniques.',
      action: null,
      uncertain: null,
      sources: [{ name: 'TechCrunch', url: 'https://tc.com/b', kind: 'presse' }],
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
