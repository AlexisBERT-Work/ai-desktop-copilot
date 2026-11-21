import { describe, expect, it } from 'vitest';
import {
  claimCorrection,
  claimNotice,
  findUnbackedClaim,
  isEmptyAnswer,
  type ToolOutcome,
} from './claimCheck';

const ok = (name: string): ToolOutcome => ({ name, success: true, content: '{}' });
const failed = (name: string): ToolOutcome => ({ name, success: false, content: '' });

describe('findUnbackedClaim — mémoire', () => {
  it('repère le défaut du banc : « je me souviens » après « souviens-toi », sans store_memory', () => {
    const claim = findUnbackedClaim(
      'souviens-toi que je préfère les réponses courtes',
      "D'accord, je me souviens.",
      [],
    );
    expect(claim?.action).toBe('enregistrer en mémoire');
    expect(claim?.expected).toEqual(['store_memory']);
  });

  it('repère une annonce nette même sans demande de mémoire', () => {
    expect(findUnbackedClaim('ok', "C'est noté !", [])?.expected).toEqual(['store_memory']);
    expect(findUnbackedClaim('mon vol', 'Je m’en souviendrai.', [])).not.toBeNull();
  });

  it('accepte une annonce couverte par un store_memory réussi', () => {
    expect(findUnbackedClaim('retiens ça', "C'est noté.", [ok('store_memory')])).toBeNull();
  });

  it('un store_memory refusé ou en échec ne couvre rien : seul le résultat réel compte', () => {
    expect(findUnbackedClaim('retiens ça', "C'est noté.", [failed('store_memory')])).not.toBeNull();
  });

  it('laisse passer un vrai rappel : « je m’en souviens » sans demande de mémoriser', () => {
    expect(
      findUnbackedClaim(
        'tu te souviens du nom de mon comptable ?',
        "Oui, je m'en souviens : il s'appelle M. Durand.",
        [],
      ),
    ).toBeNull();
  });

  it("n'affirme rien au conditionnel ni dans une offre", () => {
    expect(findUnbackedClaim('mon adresse', 'Si tu veux, je m’en souviendrai.', [])).toBeNull();
    expect(
      findUnbackedClaim(
        'mon adresse',
        'Je peux la garder en mémoire, c’est noté si tu confirmes.',
        [],
      ),
    ).toBeNull();
  });

  it('ne prend pas un refus ou une question pour un acquiescement', () => {
    expect(
      findUnbackedClaim('retiens mon code', "D'accord, mais quel code exactement ?", []),
    ).toBeNull();
    expect(
      findUnbackedClaim(
        'retiens mon code',
        "D'accord, mais je ne peux pas stocker de code secret.",
        [],
      ),
    ).toBeNull();
  });

  it('ignore les questions de culture générale qui contiennent « noté »', () => {
    expect(
      findUnbackedClaim('qui a peint la Joconde ?', 'Léonard de Vinci, peintre très noté.', []),
    ).toBeNull();
  });
});

describe('findUnbackedClaim — autres actions', () => {
  it('fichier annoncé sans write_file', () => {
    const claim = findUnbackedClaim(
      'enregistre ce texte dans notes.txt',
      "J'ai bien enregistré le fichier notes.txt.",
      [],
    );
    expect(claim?.expected).toEqual(['write_file', 'export_document']);
  });

  it('« C’est fait. » après « enregistre … » sans outil', () => {
    expect(
      findUnbackedClaim('enregistre ce texte dans notes.txt', 'C’est fait.', []),
    ).not.toBeNull();
  });

  it('fichier couvert par export_document', () => {
    expect(
      findUnbackedClaim('exporte en pdf', 'Le document a été exporté.', [ok('export_document')]),
    ).toBeNull();
  });

  it('rappel, presse-papiers, message, liste de suivi', () => {
    expect(
      findUnbackedClaim('x', "J'ai programmé un rappel pour demain 9 h.", [])?.expected,
    ).toEqual(['schedule_task']);
    expect(findUnbackedClaim('x', 'Copié dans le presse-papiers.', [])?.expected).toEqual([
      'write_clipboard',
    ]);
    expect(findUnbackedClaim('x', "J'ai envoyé le message à l'équipe.", [])?.expected).toContain(
      'send_webhook_message',
    );
    expect(
      findUnbackedClaim('x', "J'ai ajouté Airbus à ta liste de suivi.", [])?.expected,
    ).toContain('add_to_watchlist');
  });

  it('annonce en tête de phrase, même derrière une puce ou un emoji', () => {
    expect(findUnbackedClaim('x', 'Fichier créé : notes.txt.', [])?.expected).toContain(
      'write_file',
    );
    expect(findUnbackedClaim('x', '✅ Rappel programmé pour 8 h.', [])?.expected).toEqual([
      'schedule_task',
    ]);
    expect(findUnbackedClaim('x', 'Le message a bien été envoyé.', [])?.expected).toContain(
      'send_webhook_message',
    );
  });

  it('un groupe nominal décrit, il n’annonce pas (banc : plan-annule)', () => {
    const cancelled = [ok('list_scheduled_tasks'), ok('cancel_scheduled_task')];
    expect(
      findUnbackedClaim(
        'annule la tâche planifiée de ce matin',
        'La tâche planifiée « Résumé actu du matin » a été annulée.',
        cancelled,
      ),
    ).toBeNull();
    expect(
      findUnbackedClaim(
        'mes tâches ?',
        'Ta tâche « Résumé » est programmée tous les jours à 8 h.',
        [ok('list_scheduled_tasks')],
      ),
    ).toBeNull();
    expect(
      findUnbackedClaim('mes mails ?', 'Voici le message envoyé par Claire : « On décale ? »', [
        ok('read_email'),
      ]),
    ).toBeNull();
    expect(findUnbackedClaim('x', 'Le document enregistré hier fait 3 pages.', [])).toBeNull();
  });

  it('ne déclenche rien sur une réponse ordinaire', () => {
    expect(findUnbackedClaim('quelle est la capitale de l’Italie ?', 'Rome.', [])).toBeNull();
    expect(findUnbackedClaim('bonjour', 'Bonjour ! Ça va bien, et toi ?', [])).toBeNull();
    expect(
      findUnbackedClaim(
        'donne-moi une idée de repas',
        'Des pâtes au pesto, prêtes en 10 minutes.',
        [],
      ),
    ).toBeNull();
  });
});

describe('messages de contrôle', () => {
  it('la relance cite l’annonce et les outils attendus, et reste courte', () => {
    const claim = findUnbackedClaim('retiens ça', "C'est noté.", []);
    if (!claim) throw new Error('annonce attendue');
    const text = claimCorrection(claim);
    expect(text).toContain("« C'est noté. »");
    expect(text).toContain('store_memory');
    expect(text.startsWith('[Vérification automatique')).toBe(true);
    expect(text.length).toBeLessThan(400);
    expect(claimNotice(claim)).toContain('enregistrer en mémoire');
  });

  it('isEmptyAnswer', () => {
    expect(isEmptyAnswer('')).toBe(true);
    expect(isEmptyAnswer('  \n ')).toBe(true);
    expect(isEmptyAnswer('Rome.')).toBe(false);
  });
});
