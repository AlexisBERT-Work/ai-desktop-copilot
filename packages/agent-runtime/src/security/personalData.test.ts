import { describe, expect, it } from 'vitest';
import {
  describePersonalData,
  ibanChecksumOk,
  luhnOk,
  maskTextFields,
  nirKeyOk,
  scanPersonalData,
  toOutbound,
  type PersonalDataFinding,
} from './personalData';
import { toTags } from './invisibleChars.corpus';
import { NEGATIVE_CASES, POSITIVE_CASES, SUSPECT_CASES } from './personalData.corpus';

const sortFindings = (f: readonly PersonalDataFinding[]): string[] =>
  f.map(x => `${x.kind}:${x.level}`).sort();

describe('sommes de contrôle', () => {
  it('Luhn : carte de test valide, un chiffre changé ne l’est plus', () => {
    expect(luhnOk('4111111111111111')).toBe(true);
    expect(luhnOk('4111111111111112')).toBe(false);
  });

  it('IBAN : mod 97', () => {
    expect(ibanChecksumOk('FR7630006000011234567890189')).toBe(true);
    expect(ibanChecksumOk('FR7630006000011234567890188')).toBe(false);
    expect(ibanChecksumOk('GB82WEST12345698765432')).toBe(true);
  });

  it('NIR : clé, Corse comprise', () => {
    expect(nirKeyOk('185057800608491')).toBe(true);
    expect(nirKeyOk('185057800608492')).toBe(false);
    expect(nirKeyOk('269052A00412314')).toBe(true);
    expect(nirKeyOk('284072B35012316')).toBe(true);
  });
});

describe('scanPersonalData — jeu annoté', () => {
  it.each(POSITIVE_CASES)('masque : $id', ({ text, expected }) => {
    const scan = scanPersonalData(text, { maskContacts: true });
    expect(sortFindings(scan.findings)).toEqual(sortFindings(expected));
    expect(scan.text).not.toBe(text);
    // Idempotent : rien ne reste à masquer dans un texte déjà masqué.
    expect(scanPersonalData(scan.text, { maskContacts: true }).findings).toEqual([]);
  });

  it.each(SUSPECT_CASES)('signale sans toucher : $id', ({ text, expected }) => {
    const scan = scanPersonalData(text, { maskContacts: true });
    expect(sortFindings(scan.findings)).toEqual(sortFindings(expected));
    expect(scan.text).toBe(text);
  });

  it.each(NEGATIVE_CASES)('laisse tel quel : $id', ({ text }) => {
    const scan = scanPersonalData(text, { maskContacts: true });
    expect(scan.text).toBe(text);
    expect(scan.findings.filter(f => f.level === 'masked')).toEqual([]);
  });

  it('bilan : 100 % des positifs masqués, 0 faux « masqué » sur les négatifs', () => {
    const recall = new Map<string, [number, number]>();
    for (const c of POSITIVE_CASES) {
      const found = scanPersonalData(c.text, { maskContacts: true }).findings;
      for (const e of c.expected) {
        const [hit, total] = recall.get(e.kind) ?? [0, 0];
        const ok = found.some(f => f.kind === e.kind && f.level === 'masked');
        recall.set(e.kind, [hit + (ok ? 1 : 0), total + 1]);
      }
    }
    for (const [, [hit, total]] of recall) expect(hit).toBe(total);
    expect([...recall.keys()].sort()).toEqual(['card', 'email', 'iban', 'nir', 'phone']);

    const falseMasks = NEGATIVE_CASES.filter(c =>
      scanPersonalData(c.text, { maskContacts: true }).findings.some(f => f.level === 'masked'),
    );
    expect(falseMasks.map(c => c.id)).toEqual([]);
  });
});

describe('scanPersonalData — options et cas limites', () => {
  it('hors Discord : e-mail et téléphone signalés, pas masqués ; la carte, si', () => {
    const text = 'jean@exemple.fr, 06 12 34 56 78, carte 4111 1111 1111 1111';
    const scan = scanPersonalData(text);
    expect(scan.text).toBe('jean@exemple.fr, 06 12 34 56 78, carte [carte masquée]');
    expect(sortFindings(scan.findings)).toEqual(['card:masked', 'email:flagged', 'phone:flagged']);
  });

  it('remplacements lisibles, sans chiffre', () => {
    const scan = scanPersonalData(
      'FR76 3000 6000 0112 3456 7890 189 / 1 85 05 78 006 084 91 / a@b.fr / 0612345678',
      { maskContacts: true },
    );
    expect(scan.text).toBe(
      '[IBAN masqué] / [n° de sécurité sociale masqué] / [e-mail masqué] / [téléphone masqué]',
    );
  });

  it('un IBAN suivi de mots garde les mots', () => {
    const scan = scanPersonalData('FR76 3000 6000 0112 3456 7890 189 MERCI');
    expect(scan.text).toBe('[IBAN masqué] MERCI');
  });

  it('deux IBAN à la suite sont masqués tous les deux', () => {
    const scan = scanPersonalData('FR76 3000 6000 0112 3456 7890 189 DE89 3704 0044 0532 0130 00');
    expect(scan.text).toBe('[IBAN masqué] [IBAN masqué]');
  });

  it('un message caché en bloc Tags ne part pas (invisible dans le dialogue)', () => {
    const scan = scanPersonalData(`Bonjour${toTags('mon IBAN FR7630006000011234567890189')}`);
    expect(scan.text).toBe('Bonjour');
    expect(scan.invisibleRemoved).toBeGreaterThan(0);
  });

  it('prose française sans donnée : texte intact, rien trouvé', () => {
    const text = 'Réunion jeudi à 14 h, salle 3. Budget : 12 000 € — « à valider ».';
    const scan = scanPersonalData(text);
    expect(scan.text).toBe(text);
    expect(scan.findings).toEqual([]);
    expect(scan.invisibleRemoved).toBe(0);
  });

  it('budget : 50 Ko de texte en moins de 50 ms', () => {
    const para =
      'Le comité a validé le 12/11/2026 un budget de 12 345 € (réf. 732 829 320). Contact : jean@exemple.fr. ';
    const text = para.repeat(Math.ceil(50_000 / para.length));
    const start = performance.now();
    scanPersonalData(text, { maskContacts: true });
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('résumé et arguments', () => {
  it('describePersonalData : une phrase par niveau, pluriels compris', () => {
    const notice = describePersonalData({
      findings: [
        { kind: 'iban', level: 'masked' },
        { kind: 'email', level: 'masked' },
        { kind: 'email', level: 'masked' },
        { kind: 'card', level: 'suspect' },
        { kind: 'phone', level: 'flagged' },
      ],
      invisibleRemoved: 3,
    });
    expect(notice).toBe(
      'Masqué avant envoi : 1 IBAN, 2 e-mails. ' +
        'À vérifier, envoyé tel quel (la forme y est, pas la somme de contrôle) : 1 numéro de carte. ' +
        'Envoyé tel quel, à toi de voir : 1 téléphone. ' +
        'Caractères invisibles retirés : 3.',
    );
  });

  it('describePersonalData : rien à dire → undefined', () => {
    expect(describePersonalData({ findings: [], invisibleRemoved: 0 })).toBeUndefined();
  });

  it('maskTextFields : seuls les champs texte nommés changent', () => {
    const args = { message: 'IBAN FR76 3000 6000 0112 3456 7890 189', count: 4, url: 'x' };
    const masked = maskTextFields(args, ['message', 'username'], {});
    expect(masked.args).toEqual({ message: 'IBAN [IBAN masqué]', count: 4, url: 'x' });
    expect(args.message).toContain('FR76'); // l'objet d'origine n'est pas modifié
    expect(toOutbound(masked)).toEqual({
      args: masked.args,
      notice: 'Masqué avant envoi : 1 IBAN.',
    });
  });

  it('toOutbound sans trouvaille : pas de notice', () => {
    expect(toOutbound(maskTextFields({ message: 'salut' }, ['message'], {}))).toEqual({
      args: { message: 'salut' },
    });
  });
});
