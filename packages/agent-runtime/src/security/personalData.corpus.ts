// Jeu annoté du masquage des données personnelles (piste 2 de la veille).
// Tous les numéros sont fictifs : cartes de test publiques des réseaux, IBAN
// d'exemple des banques, NIR construits pour l'occasion (clé calculée).
// Caractères spéciaux construits par code : un échappement dans la source peut
// être réécrit par un outil d'édition.

import type { PersonalDataKind, PersonalDataLevel } from './personalData';

const NBSP = String.fromCharCode(0xa0);
const NARROW_NBSP = String.fromCharCode(0x202f);
const ZWSP = String.fromCharCode(0x200b);

export interface PersonalDataCase {
  readonly id: string;
  readonly text: string;
  /** Trouvailles attendues, sur Discord (e-mails et téléphones masqués). */
  readonly expected: readonly { kind: PersonalDataKind; level: PersonalDataLevel }[];
}

const masked = (kind: PersonalDataKind) => ({ kind, level: 'masked' as const });
const suspect = (kind: PersonalDataKind) => ({ kind, level: 'suspect' as const });

/** Forme et somme de contrôle valides : tout doit être masqué. */
export const POSITIVE_CASES: readonly PersonalDataCase[] = [
  // Cartes
  {
    id: 'visa-espaces',
    text: 'Ma carte : 4111 1111 1111 1111, exp 12/28',
    expected: [masked('card')],
  },
  { id: 'visa-colle', text: 'Paie avec 4012888888881881 stp', expected: [masked('card')] },
  { id: 'visa-19', text: 'Carte 4111 1111 1111 1111 003', expected: [masked('card')] },
  { id: 'mastercard-tirets', text: 'MC : 5555-5555-5555-4444', expected: [masked('card')] },
  { id: 'mastercard-2', text: 'Nouvelle carte 2223 0031 2200 3222.', expected: [masked('card')] },
  { id: 'amex', text: 'Amex 3782 822463 10005', expected: [masked('card')] },
  { id: 'discover', text: '6011 1111 1111 1117', expected: [masked('card')] },
  { id: 'jcb', text: 'JCB : 3530 1113 3330 0000', expected: [masked('card')] },
  { id: 'unionpay', text: 'UnionPay 6200 0000 0000 0005', expected: [masked('card')] },
  // IBAN
  { id: 'iban-fr', text: 'IBAN : FR76 3000 6000 0112 3456 7890 189', expected: [masked('iban')] },
  {
    id: 'iban-fr-lettre',
    text: 'Virement sur FR14 2004 1010 0505 0001 3M02 606.',
    expected: [masked('iban')],
  },
  {
    id: 'iban-minuscules-colle',
    text: 'rib fr7630006000011234567890189',
    expected: [masked('iban')],
  },
  {
    id: 'iban-suivi-de-mots',
    text: 'FR76 3000 6000 0112 3456 7890 189 MERCI BEAUCOUP',
    expected: [masked('iban')],
  },
  {
    id: 'iban-largeur-nulle',
    text: `FR76 3000${ZWSP}6000 0112 3456 7890 189`,
    expected: [masked('iban')],
  },
  { id: 'iban-de', text: 'DE89 3704 0044 0532 0130 00', expected: [masked('iban')] },
  { id: 'iban-be', text: 'Compte belge BE68 5390 0754 7034', expected: [masked('iban')] },
  { id: 'iban-gb', text: 'GB82 WEST 1234 5698 7654 32', expected: [masked('iban')] },
  { id: 'iban-ch', text: 'CH93 0076 2011 6238 5295 7', expected: [masked('iban')] },
  { id: 'iban-mc', text: 'MC58 1122 2000 0101 2345 6789 030', expected: [masked('iban')] },
  // NIR
  { id: 'nir-espaces', text: 'Sécu : 1 85 05 78 006 084 91', expected: [masked('nir')] },
  { id: 'nir-colle', text: 'NIR 185057800608491', expected: [masked('nir')] },
  { id: 'nir-corse-2a', text: 'n° 2 69 05 2A 004 123 14', expected: [masked('nir')] },
  { id: 'nir-corse-2b', text: 'numéro 284072B35012316', expected: [masked('nir')] },
  // Téléphones
  { id: 'tel-espaces', text: 'Appelle-moi au 06 12 34 56 78.', expected: [masked('phone')] },
  { id: 'tel-points', text: 'Tél. 06.12.34.56.78', expected: [masked('phone')] },
  { id: 'tel-colle', text: 'tel:0612345678', expected: [masked('phone')] },
  { id: 'tel-plus33', text: '+33 6 12 34 56 78', expected: [masked('phone')] },
  { id: 'tel-plus33-zero', text: 'Standard : +33 (0)1 23 45 67 89', expected: [masked('phone')] },
  { id: 'tel-0033', text: '0033 6 12 34 56 78', expected: [masked('phone')] },
  { id: 'tel-tirets', text: 'Fixe 01-23-45-67-89', expected: [masked('phone')] },
  {
    id: 'tel-insecables',
    text: `06${NBSP}12${NBSP}34${NBSP}56${NBSP}78`,
    expected: [masked('phone')],
  },
  {
    id: 'tel-fines',
    text: `07${NARROW_NBSP}98${NARROW_NBSP}76${NARROW_NBSP}54${NARROW_NBSP}32`,
    expected: [masked('phone')],
  },
  // E-mails
  { id: 'email-simple', text: 'Écris à jean.dupont@exemple.fr', expected: [masked('email')] },
  {
    id: 'email-plus-sous-domaine',
    text: 'marie+factures@sous.domaine.co.uk',
    expected: [masked('email')],
  },
  { id: 'email-ponctuation', text: '(contact@catdesk.app).', expected: [masked('email')] },
  // Mélange
  {
    id: 'melange',
    text: 'Jean (jean@exemple.fr, 06 12 34 56 78) a viré sur FR76 3000 6000 0112 3456 7890 189.',
    expected: [masked('iban'), masked('email'), masked('phone')],
  },
];

/** La forme y est, pas la somme de contrôle : laissé tel quel, signalé. */
export const SUSPECT_CASES: readonly PersonalDataCase[] = [
  { id: 'carte-luhn-faux', text: 'Carte 4111 1111 1111 1112', expected: [suspect('card')] },
  {
    id: 'iban-cle-fausse',
    text: 'FR76 3000 6000 0112 3456 7890 188',
    expected: [suspect('iban')],
  },
  { id: 'nir-cle-fausse', text: '1 85 05 78 006 084 92', expected: [suspect('nir')] },
];

/** Chiffres ordinaires : rien ne doit être masqué. */
export const NEGATIVE_CASES: readonly { id: string; text: string }[] = [
  {
    id: 'url-discord',
    text: 'https://discord.com/channels/1234567890123456789/1306842789123456789',
  },
  {
    id: 'url-article',
    text: 'https://www.lemonde.fr/economie/article/2026/11/12/la-bourse_6390123_3234.html',
  },
  { id: 'commande-amazon', text: 'Commande 112-4567890-1234567' },
  { id: 'commande-16', text: 'Commande n° 4000 1234 5678 9010' },
  { id: 'timestamp-s', text: 'ts=1731412800' },
  { id: 'timestamp-ms', text: 'créé à 1731412800123' },
  { id: 'date-iso', text: '2026-11-12T08:30:00Z' },
  { id: 'date-fr', text: 'le 12/11/2026 à 08h30' },
  { id: 'heure-micro', text: '08:30:00.123456' },
  { id: 'siret', text: 'SIRET 732 829 320 00074' },
  { id: 'siret-colle', text: 'siret=73282932000074' },
  { id: 'siren', text: 'SIREN 732 829 320' },
  { id: 'numero-fiscal', text: 'Numéro fiscal 30 12 345 678 901' },
  { id: 'colis-laposte', text: 'Suivi 6A12345678901' },
  { id: 'colis-ups', text: 'UPS 1Z999AA10123456784' },
  { id: 'versions', text: 'v0.1.3 puis 1.2.3.4' },
  { id: 'ip', text: '192.168.1.10 et 10.0.0.1' },
  { id: 'prix', text: '1 234,56 € puis 12 345 678 €' },
  { id: 'pourcentage', text: '0,5 % de 1 000 000' },
  { id: 'coordonnees', text: '48.8566, 2.3522' },
  { id: 'numeros-courts', text: 'Appelle le 3949 ou le 15' },
  { id: 'code-postal', text: '75011 Paris' },
  { id: 'snowflake', text: 'Message 1306842789123456789' },
  { id: 'reference-longue', text: 'Référence 12345678901234567890' },
  { id: 'git-ssh', text: 'git@github.com:AlexisBERT-Work/ai-desktop-copilot.git' },
  { id: 'mentions', text: '@everyone et @Alexis' },
  { id: 'paquet-npm', text: '@catdesk/shared-types' },
  { id: 'hash', text: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { id: 'prefixe-iban', text: 'FR76 est le préfixe des IBAN français' },
  { id: 'annees', text: '2025-2026' },
];
