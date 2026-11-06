import type { ToolResult } from '@catdesk/shared-types';

/** Réponse simulée d'un outil, selon les arguments que le modèle lui passe. */
export type SimulatedResponse = (args: Record<string, unknown>) => ToolResult;

export type SimulatedWorld = Readonly<Record<string, SimulatedResponse>>;

/** Le seul calendrier du monde simulé. */
export const CALENDAR_PATH = 'C:/Users/moi/Documents/agenda.ics';

const ok =
  (data: unknown): SimulatedResponse =>
  () => ({ success: true, data });

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Un poste fictif, fixe : les tâches du banc attendent ses faits dans la
 * réponse (« dentiste », « 231,40 »). Chaque fait est assez singulier pour que
 * le modèle ne puisse pas le deviner : le retrouver prouve qu'il a lu l'outil.
 * Formes de données proches des vrais outils, sans chercher à les copier.
 *
 * `now` : les dates sont relatives au jour du run, car l'orchestrateur donne la
 * vraie date au modèle (« demain » doit tomber sur le rendez-vous).
 */
export function simulatedWorld(now: Date): SimulatedWorld {
  const day = (offset: number): string =>
    isoDay(new Date(now.getTime() + offset * 24 * 60 * 60 * 1000));

  const calendar = {
    count: 2,
    truncated: false,
    events: [
      { summary: 'Dentiste', start: `${day(1)}T14:30:00`, end: `${day(1)}T15:00:00` },
      { summary: 'Réunion budget', start: `${day(2)}T10:00:00`, end: `${day(2)}T11:00:00` },
    ],
  };

  return {
    read_email: ok({
      mailbox: 'INBOX',
      count: 3,
      messages: [
        {
          from: 'EDF <facture@edf.fr>',
          subject: 'Votre facture de novembre',
          date: `${day(0)}T08:12:00`,
          seen: false,
          preview: 'Montant : 82,40 €, prélevé le 15 du mois.',
        },
        {
          from: 'Claire Martin <claire.martin@exemple.fr>',
          subject: 'Réunion budget déplacée',
          date: `${day(0)}T07:45:00`,
          seen: false,
          preview: 'On passe à jeudi 10 h.',
        },
        {
          from: 'Crédit Agricole <alertes@ca.exemple.fr>',
          subject: 'Votre relevé de compte est disponible',
          date: `${day(-1)}T18:03:00`,
          seen: true,
          preview: 'Consultez votre relevé mensuel dans votre espace client.',
        },
      ],
    }),
    // Comme le vrai outil, il faut un fichier qui existe : aucun chemin par
    // défaut n'est configuré. Un chemin inventé par le modèle doit échouer, sinon
    // le banc masquerait que « mon agenda » ne mène nulle part sans chemin.
    read_calendar: args => {
      const path = String(args['path'] ?? '').replace(/\\/g, '/');
      return path.toLowerCase() === CALENDAR_PATH.toLowerCase()
        ? { success: true, data: calendar }
        : { success: false, error: `Fichier introuvable : ${path}` };
    },
    get_market: ok({
      quotes: [
        { symbol: 'AAPL', name: 'Apple', price: 231.4, changePercent: 1.2, currency: 'USD' },
        { symbol: '^FCHI', name: 'CAC 40', price: 8124.55, changePercent: 0.6, currency: 'EUR' },
        {
          symbol: 'TTE.PA',
          name: 'TotalEnergies',
          price: 61.2,
          changePercent: -0.4,
          currency: 'EUR',
        },
        { symbol: 'BTC-USD', name: 'Bitcoin', price: 71540, changePercent: 2.1, currency: 'USD' },
      ],
      formulas: [],
    }),
    describe_screen: ok({
      description: 'Un classeur Excel ouvert sur la feuille « Budget 2027 », colonnes par mois.',
    }),
    ocr_region: ok({ text: 'Total TTC : 1 284,50 €', confidence: 0.86 }),
    capture_screen: ok({ path: 'C:/Users/moi/AppData/Local/Temp/capture.png', width: 2560 }),
    parse_document: ok({
      pages: 4,
      text: 'Le rapport conclut à une hausse de 12 % des ventes, portée par le marché allemand.',
    }),
    analyze_data: ok({
      rows: 120,
      columns: ['produit', 'prix', 'quantite'],
      stats: { prix: { mean: 42.5, min: 3, max: 310 } },
    }),
    transcribe_audio: ok({ text: 'Penser à rappeler le garagiste lundi.', language: 'fr' }),
    read_file: ok({ content: '{ "theme": "sombre", "langue": "fr" }', size: 38 }),
    list_directory: ok({
      entries: [
        { name: 'facture-edf.pdf', type: 'file' },
        { name: 'vacances-2026.zip', type: 'file' },
      ],
    }),
    obsidian_notes: ok({
      notes: [{ path: 'Projets/Atlas.md', excerpt: 'Livraison prévue en mars, recette du pain.' }],
    }),
    notion_search: ok({
      results: [{ title: 'Budget 2027', excerpt: 'Enveloppe de 40 000 €, lancement en janvier.' }],
    }),
    run_command: ok({
      exitCode: 0,
      stdout: 'Adresse IPv4 : 192.168.1.42\nC: libre 214 Go\nWindows 11 Pro 26300',
    }),
    load_skill: ok({
      name: 'revue-comparee',
      source: 'bundled',
      instructions: 'Regroupe les résultats de search_dailies par journal et relève les angles.',
    }),
    search_dailies: ok({
      dailies: [
        {
          journal: 'Tech',
          date: day(-1),
          title: 'Mistral boucle une levée de 1,2 Md€',
          excerpt: 'Nvidia, de son côté, détaille ses puces Blackwell Ultra.',
        },
      ],
      totalInWindow: 1,
    }),
    read_webpage: ok({
      title: 'Lyon : le tramway T9 ouvre en mars',
      text: 'La nouvelle ligne de tramway T9 relie Vaulx-en-Velin à La Doua.',
    }),
    fetch_tech_news: ok({
      items: [{ source: 'Hacker News', title: 'Rust 2.0 est annoncé pour 2027' }],
    }),
    read_clipboard: ok({ text: 'Commander les billets pour Lyon' }),
    search_memory: ok({
      results: [{ content: 'Mon comptable s’appelle M. Durand.', score: 0.82 }],
    }),
    list_scheduled_tasks: ok({
      tasks: [{ id: 'tache-1', name: 'Résumé actu du matin', schedule: 'daily', enabled: true }],
    }),
  };
}
