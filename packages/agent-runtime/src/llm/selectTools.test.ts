import { describe, it, expect } from 'vitest';
import { coreTools, selectTools, type SelectableTool } from './selectTools';

const make = (name: string, description = '', category = 'x'): SelectableTool => ({
  name,
  description,
  category,
});

// A stand-in for the ~50-tool registry.
const tools: SelectableTool[] = [
  make('read_file', 'Lit un fichier', 'filesystem'),
  make('list_directory', 'Liste un dossier', 'filesystem'),
  make('run_command', 'Exécute une commande', 'system'),
  make('read_clipboard', 'Lit le presse-papier', 'clipboard'),
  make('search_memory', 'Cherche en mémoire', 'memory'),
  make('list_scheduled_tasks', 'Liste les tâches planifiées récurrentes', 'automation'),
  make('schedule_task', 'Planifie une tâche récurrente quotidienne', 'automation'),
  make('cancel_scheduled_task', 'Annule une tâche planifiée', 'automation'),
  make('fetch_tech_news', 'Récupère les actualités tech', 'web'),
  make('search_dailies', 'Recherche et lit les revues de presse quotidiennes (dailys)', 'web'),
  make('read_webpage', 'Lit une page web et en extrait le texte', 'web'),
  make('post_tech_news_discord', 'Publie la revue de presse tech sur Discord', 'web'),
  make('git_commit', 'Crée un commit git', 'git'),
  make('git_pr', 'Ouvre une pull request', 'git'),
  make('browser_navigate', 'Navigue vers une URL', 'browser'),
  make('docker_ps', 'Liste les conteneurs docker', 'infra'),
  make('analyze_stacktrace', 'Analyse une stacktrace', 'analysis'),
  make('describe_screen', "Décrit l'écran", 'screen'),
];

describe('selectTools', () => {
  it('caps the number of tools', () => {
    expect(selectTools(tools, 'fais quelque chose', 8).length).toBeLessThanOrEqual(8);
  });

  it('returns all when under the limit or limit=0', () => {
    expect(selectTools(tools, 'x', 0)).toHaveLength(tools.length);
    expect(selectTools(tools.slice(0, 5), 'x', 14)).toHaveLength(5);
  });

  it('always keeps the essential core (research + scheduling)', () => {
    const names = selectTools(tools, 'bonjour ça va', 14).map(t => t.name);
    expect(names).toContain('list_scheduled_tasks');
    expect(names).toContain('schedule_task');
    expect(names).toContain('search_dailies');
    expect(names).toContain('read_webpage');
  });

  it('les outils fichiers/shell ne remontent que si la requête les évoque', () => {
    const trivial = selectTools(tools, 'bonjour ça va', 14).map(t => t.name);
    expect(trivial).not.toContain('run_command');
    const explicit = selectTools(tools, 'exécute une commande shell', 14).map(t => t.name);
    expect(explicit).toContain('run_command');
  });

  it('"quelles sont mes dailies" keeps the scheduling tools', () => {
    const names = selectTools(tools, 'quelles sont mes dailies ?', 12).map(t => t.name);
    expect(names).toContain('list_scheduled_tasks');
  });

  it('selects domain tools by query keywords (discord/news)', () => {
    const names = selectTools(tools, 'publie les news tech sur discord', 14).map(t => t.name);
    expect(names).toContain('post_tech_news_discord');
    expect(names).toContain('fetch_tech_news');
  });

  it('selects git tools for a git query', () => {
    const names = selectTools(tools, 'fais un commit git', 14).map(t => t.name);
    expect(names).toContain('git_commit');
  });

  it('does not pull unrelated domain tools for a trivial query', () => {
    const names = selectTools(tools, 'quelle heure est-il', 14).map(t => t.name);
    expect(names).not.toContain('docker_ps');
    expect(names).not.toContain('browser_navigate');
  });

  it("latence : le noyau en tête, puis les outils retenus dans l'ordre d'enregistrement", () => {
    // Deux formulations qui retiennent les mêmes outils doivent produire la
    // MÊME liste, dans le même ordre : sinon Ollama relit tout le prompt.
    const a = selectTools(tools, 'publie la revue de presse tech sur discord et un commit git', 10);
    const b = selectTools(tools, 'git commit puis discord : revue de presse tech', 10);
    expect(a.map(t => t.name)).toEqual(b.map(t => t.name));

    const core = coreTools(tools, 10).map(t => t.name);
    expect(a.slice(0, core.length).map(t => t.name)).toEqual(core);
    const extras = a.slice(core.length).map(t => tools.indexOf(t));
    expect(extras).toEqual([...extras].sort((x, y) => x - y));
  });

  describe('seuil de pertinence', () => {
    const filler = Array.from({ length: 12 }, (_, i) => make(`filler_${i}`, 'zzz', 'zzz'));
    const webhook = make('send_webhook', 'Envoie un message vers une adresse web', 'connectors');
    const picked = (query: string, keywords = {}): string[] =>
      selectTools([webhook, ...filler], query, 5, keywords).map(t => t.name);

    it('un seul mot commun avec la description ne suffit pas', () => {
      expect(picked('quelle est mon adresse de livraison ?')).not.toContain('send_webhook');
    });

    it('deux mots communs suffisent', () => {
      expect(picked('envoie ce message')).toContain('send_webhook');
    });

    it('un mot-clé suffit à lui seul', () => {
      expect(picked('préviens le canal slack', { send_webhook: ['slack'] })).toContain(
        'send_webhook',
      );
    });
  });

  describe('racines trop courtes', () => {
    it("« IDs » ne fait pas remonter un outil sur « idée » : la racine « id » n'est pas un mot", () => {
      const withIds = make('cancel_task', 'Annule une tâche. Donne les IDs.', 'automation');
      const filler = Array.from({ length: 12 }, (_, i) => make(`filler_${i}`, 'zzz', 'zzz'));
      const picked = selectTools([withIds, ...filler], 'une idée de repas', 5, {});
      expect(picked.map(t => t.name)).not.toContain('cancel_task');
    });
  });

  describe('mots-clés de sélection', () => {
    const pool = [...tools, make('read_calendar', 'Lit un fichier .ics', 'files')];
    const keywords = { read_calendar: ['agenda', 'rendez-vous'], docker_ps: ['conteneur'] };
    const names = (query: string, limit = 12): string[] =>
      selectTools(pool, query, limit, keywords).map(t => t.name);

    it('trouve un outil dont la description ne contient pas le mot', () => {
      expect(names("qu'est-ce que j'ai à l'agenda demain ?")).toContain('read_calendar');
      expect(
        selectTools(pool, "qu'est-ce que j'ai à l'agenda demain ?", 12, {}),
      ).not.toContainEqual(expect.objectContaining({ name: 'read_calendar' }));
    });

    it('ignore les accents, la casse et la ponctuation', () => {
      expect(names('Mes RENDEZ VOUS de la semaine')).toContain('read_calendar');
    });

    it('ne trouve que des débuts de mot', () => {
      expect(names('des agendas')).toContain('read_calendar');
      expect(names('la micro-agendaire')).toContain('read_calendar');
      expect(names('un mégaagenda')).not.toContain('read_calendar');
    });

    it('passe devant un mot commun avec une description quand les places manquent', () => {
      // Une seule place hors noyau : « commande » (description) contre « agenda ».
      const core = coreTools(pool, 8).length;
      const picked = names('une commande à mon agenda', core + 1);
      expect(picked).toContain('read_calendar');
      expect(picked).not.toContain('run_command');
    });

    it("n'a aucun effet sur le schéma envoyé au modèle", () => {
      // La table n'est lue que par la sélection : l'objet outil reste le même.
      const selected = selectTools(pool, 'mon agenda', 12, keywords);
      const calendar = selected.find(t => t.name === 'read_calendar');
      expect(calendar).toBe(pool.find(t => t.name === 'read_calendar'));
      expect(calendar?.description).not.toContain('agenda');
    });
  });

  it('les mots grammaticaux ne font remonter aucun outil (prompt minimal et stable)', () => {
    const names = selectTools(tools, 'Quelle est la capitale de la France ? Une phrase.', 10).map(
      t => t.name,
    );
    expect(names).toEqual(coreTools(tools, 10).map(t => t.name));
  });
});
