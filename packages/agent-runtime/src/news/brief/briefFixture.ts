import type { Brief } from './briefSchema';

/** Brief d'exemple partagé par les tests du rendu et des visuels. */
export const BRIEF_FIXTURE: Brief = {
  headline: 'OpenAI <ouvre> ses agents à Chrome',
  essentials: ['ChatGPT agit dans les onglets ouverts.', 'La CNIL publie un guide **RGPD**.'],
  leads: [
    {
      title: 'ChatGPT devient un assistant de navigateur',
      summary: 'L’extension lit les onglets & agit dessus.',
      whyItMatters: 'Nouveaux risques de fuite de données.',
      imageUrl: 'https://cdn.ex.com/a.jpg',
      diagram: { mermaid: 'flowchart LR\n A-->B', caption: 'Chaîne d’accès' },
      sources: [
        { name: 'The Decoder', url: 'https://the-decoder.com/a' },
        { name: 'Piège', url: 'javascript:alert(1)' },
      ],
    },
  ],
  sections: [
    {
      name: 'Sécurité',
      items: [
        {
          title: 'Agents malveillants en Inde',
          summary: 'Le CERT-In alerte.',
          url: 'https://tc.com/b',
          source: 'TechCrunch',
        },
      ],
    },
    {
      name: 'Modèles & recherche',
      items: [
        {
          title: 'Gemini 4',
          summary: 'Proche de la frontière.',
          url: 'https://the-decoder.com/c',
          source: 'The Decoder',
        },
      ],
    },
    { name: 'Produits & outils', items: [] },
  ],
  forTheLead: ['Recenser les extensions IA autorisées.'],
  toWatch: [],
};
