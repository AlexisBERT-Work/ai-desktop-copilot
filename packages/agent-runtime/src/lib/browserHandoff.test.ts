import { describe, expect, it } from 'vitest';
import {
  COLLECT_SIGNALS_SCRIPT,
  detectHandoff,
  handoffReport,
  mergeSignals,
  words,
  type FieldSignal,
  type FrameSignal,
  type HandoffKind,
  type PageSignals,
} from './browserHandoff';

const field = (f: Partial<FieldSignal>): FieldSignal => ({
  type: 'text',
  name: '',
  id: '',
  autocomplete: '',
  placeholder: '',
  label: '',
  inputMode: '',
  maxLength: -1,
  ...f,
});
const frame = (f: Partial<FrameSignal>): FrameSignal => ({ src: '', name: '', title: '', ...f });
const page = (p: Partial<PageSignals>): PageSignals => ({
  url: 'https://exemple.fr/',
  title: 'Exemple',
  fields: [],
  frames: [],
  challengeElements: [],
  ...p,
});

const email = field({ type: 'email', name: 'email', autocomplete: 'email', label: 'E-mail' });
const password = field({ type: 'password', name: 'password', autocomplete: 'current-password' });
const v3Badge = frame({
  src: 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=abc&size=invisible&cb=1',
  title: 'reCAPTCHA',
});

// Mesure de la veille du 15/11 : au moins 9 détections sur 10, au plus une
// fausse alerte sur 10 formulaires ordinaires. Ici, 10 sur 10 et aucune.
const TO_HAND_OFF: Array<[string, PageSignals, HandoffKind]> = [
  [
    'reCAPTCHA v2 (case à cocher)',
    page({
      fields: [email],
      frames: [frame({ src: 'https://www.google.com/recaptcha/api2/anchor?k=abc&size=normal' })],
    }),
    'captcha',
  ],
  [
    'hCaptcha',
    page({
      frames: [
        frame({
          src: 'https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox',
        }),
      ],
    }),
    'captcha',
  ],
  [
    'page d’attente Cloudflare',
    page({ title: 'Just a moment...', challengeElements: ['#challenge-running'] }),
    'captcha',
  ],
  [
    'CAPTCHA image maison (Amazon)',
    page({
      fields: [field({ name: 'field-keywords', placeholder: 'Type characters' })],
      challengeElements: ['form[action*="captcha" i]'],
    }),
    'captcha',
  ],
  [
    'code 2FA (autocomplete one-time-code)',
    page({
      fields: [
        field({
          name: 'app_otp',
          id: 'app_totp',
          autocomplete: 'one-time-code',
          inputMode: 'numeric',
        }),
      ],
    }),
    'one_time_code',
  ],
  [
    'code reçu par SMS (libellé français)',
    page({
      fields: [
        field({
          type: 'tel',
          name: 'code',
          label: 'Saisissez le code de vérification reçu par SMS',
        }),
      ],
    }),
    'one_time_code',
  ],
  [
    'six cases d’un chiffre',
    page({
      fields: Array.from({ length: 6 }, (_, i) =>
        field({ name: `d${i}`, maxLength: 1, inputMode: 'numeric' }),
      ),
    }),
    'one_time_code',
  ],
  [
    'formulaire de carte en clair (autocomplete cc-*)',
    page({
      fields: [
        field({ name: 'card', autocomplete: 'cc-number' }),
        field({ name: 'exp', autocomplete: 'cc-exp' }),
        field({ name: 'cvc', autocomplete: 'cc-csc', label: 'Security code' }),
      ],
    }),
    'payment',
  ],
  [
    'iframe Stripe Elements',
    page({
      fields: [email],
      frames: [
        frame({
          src: 'https://js.stripe.com/v3/elements-inner-card-1234.html#wait=false',
          name: '__privateStripeFrame1234',
          title: 'Cadre de saisie sécurisé pour le paiement par carte',
        }),
      ],
    }),
    'payment',
  ],
  [
    'numéro de carte sans autocomplete (libellé français)',
    page({
      fields: [
        field({ name: 'num', label: 'Numéro de carte' }),
        field({ name: 'crypto', label: 'Cryptogramme visuel' }),
      ],
    }),
    'payment',
  ],
];

const ORDINARY: Array<[string, PageSignals]> = [
  ['connexion (e-mail + mot de passe)', page({ fields: [email, password] })],
  [
    'recherche',
    page({ fields: [field({ type: 'search', name: 'q', placeholder: 'Rechercher' })] }),
  ],
  [
    'contact, avec badge reCAPTCHA v3 invisible',
    page({
      fields: [email, field({ name: 'message', label: 'Votre message' })],
      frames: [v3Badge],
    }),
  ],
  [
    'adresse de livraison (code postal)',
    page({
      fields: [
        field({ name: 'address1', autocomplete: 'address-line1' }),
        field({ name: 'zip', autocomplete: 'postal-code', label: 'Code postal' }),
        field({ name: 'city', autocomplete: 'address-level2' }),
      ],
    }),
  ],
  ['panier avec code promo', page({ fields: [field({ name: 'coupon', label: 'Code promo' })] })],
  [
    'réservation retrouvée par code de confirmation',
    page({
      fields: [field({ name: 'pnr', label: 'Code de confirmation' }), field({ name: 'lastName' })],
    }),
  ],
  [
    'inscription à la newsletter',
    page({
      fields: [field({ type: 'email', name: 'newsletter_email', placeholder: 'Votre e-mail' })],
    }),
  ],
  [
    'Stripe chargé sur toutes les pages (cadres masqués non relevés) + adresse',
    page({
      frames: [
        frame({
          src: 'https://js.stripe.com/v3/elements-inner-address-77.html',
          title: 'Secure address input frame',
        }),
      ],
    }),
  ],
  [
    'formulaire de pièce d’identité (date d’expiration seule)',
    page({ fields: [field({ name: 'idExpiry', label: "Date d'expiration de la pièce" })] }),
  ],
  [
    'vidéo YouTube intégrée',
    page({
      frames: [frame({ src: 'https://www.youtube.com/embed/abc', title: 'YouTube video player' })],
    }),
  ],
];

describe('detectHandoff — pages à rendre à l’utilisateur', () => {
  it.each(TO_HAND_OFF)('%s', (_label, signals, kind) => {
    expect(detectHandoff(signals)?.kind).toBe(kind);
  });
});

describe('detectHandoff — formulaires ordinaires', () => {
  it.each(ORDINARY)('%s', (_label, signals) => {
    expect(detectHandoff(signals)).toBeNull();
  });
});

describe('detectHandoff — détails', () => {
  it('paiement avant code : un « security code » de carte reste un paiement', () => {
    const signals = page({
      fields: [
        field({ name: 'cardNumber' }),
        field({ name: 'securityCode', label: 'Security code' }),
      ],
    });
    expect(detectHandoff(signals)?.kind).toBe('payment');
  });

  it('page de paiement hébergée (checkout.stripe.com) : paiement même sans champ relevé', () => {
    expect(detectHandoff(page({ url: 'https://checkout.stripe.com/c/pay/cs_live_x' }))?.kind).toBe(
      'payment',
    );
  });

  it('défi reCAPTCHA (bframe) apparu après un envoi : CAPTCHA', () => {
    const signals = page({
      frames: [v3Badge, frame({ src: 'https://www.google.com/recaptcha/api2/bframe?hl=fr&k=abc' })],
    });
    expect(detectHandoff(signals)?.kind).toBe('captcha');
  });

  it('autocomplete à plusieurs jetons (section, billing)', () => {
    const signals = page({ fields: [field({ autocomplete: 'section-pay billing cc-number' })] });
    expect(detectHandoff(signals)).toMatchObject({
      kind: 'payment',
      evidence: 'autocomplete=cc-number',
    });
  });

  it('accent en fin de libellé : « code de sécurité » est reconnu', () => {
    expect(detectHandoff(page({ fields: [field({ label: 'Code de sécurité' })] }))?.kind).toBe(
      'one_time_code',
    );
  });

  it('words découpe camelCase, tirets et soulignés', () => {
    expect(words('totpPin card-number cc_csc')).toBe('totp pin card number cc csc');
  });
});

describe('mergeSignals', () => {
  it('URL et titre du cadre principal ; champs et cadres de tous', () => {
    const merged = mergeSignals([
      page({ url: 'https://boutique.fr/paiement', title: 'Paiement', fields: [email] }),
      page({
        url: 'https://js.stripe.com/x',
        title: '',
        fields: [field({ autocomplete: 'cc-number' })],
      }),
    ]);
    expect(merged.url).toBe('https://boutique.fr/paiement');
    expect(merged.title).toBe('Paiement');
    expect(merged.fields).toHaveLength(2);
    expect(detectHandoff(merged)?.kind).toBe('payment');
  });
});

describe('handoffReport', () => {
  it('dit à l’utilisateur quoi faire, et au modèle de ne pas réessayer', () => {
    const report = handoffReport(
      { kind: 'one_time_code', evidence: 'x' },
      'https://exemple.fr/2fa',
    );
    expect(report).toMatchObject({
      handedOff: true,
      reason: 'one_time_code',
      url: 'https://exemple.fr/2fa',
      userAction: expect.stringContaining('À toi de jouer'),
      notice: expect.stringContaining('Ne réessaie pas'),
    });
    expect(report).not.toHaveProperty('evidence');
  });
});

describe('COLLECT_SIGNALS_SCRIPT', () => {
  it('est une expression autonome, sans aide injectée par le compilateur', () => {
    expect(COLLECT_SIGNALS_SCRIPT.startsWith('(() => {')).toBe(true);
    expect(COLLECT_SIGNALS_SCRIPT.trimEnd().endsWith('})()')).toBe(true);
    expect(COLLECT_SIGNALS_SCRIPT).not.toContain('__name');
    // Syntaxe valide : compilable comme corps de fonction.
    expect(() => new Function(`return ${COLLECT_SIGNALS_SCRIPT};`)).not.toThrow();
  });
});
