/**
 * « À toi de jouer » : repérer, avant un clic ou une saisie de l'agent, les
 * pages où c'est à l'utilisateur d'agir lui-même — un CAPTCHA, un code à usage
 * unique (2FA), un formulaire ou une iframe de paiement. Idée reprise de
 * `detect_handoff` (Omodaka9375/browserr, Apache-2.0, veille du 15/11) ; le
 * code est propre à CatDesk.
 *
 * Deux moitiés : `COLLECT_SIGNALS_SCRIPT` relève dans chaque cadre ce qui est
 * VISIBLE (champs, iframes, éléments de défi), et `detectHandoff` en décide,
 * pur et testable sans navigateur.
 */

export type HandoffKind = 'captcha' | 'one_time_code' | 'payment';

export interface Handoff {
  kind: HandoffKind;
  /** Indice qui a décidé (journal, tests) — jamais montré tel quel à l'utilisateur. */
  evidence: string;
}

/** Un champ de saisie visible. */
export interface FieldSignal {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  /** `aria-label`, `<label for>` ou `<label>` englobant. */
  label: string;
  inputMode: string;
  /** -1 sans limite. */
  maxLength: number;
}

/** Une iframe visible. */
export interface FrameSignal {
  src: string;
  name: string;
  title: string;
}

/** Ce que la page montre, tous cadres confondus (sauf `url` et `title` : le cadre principal). */
export interface PageSignals {
  url: string;
  title: string;
  fields: FieldSignal[];
  frames: FrameSignal[];
  /** Sélecteurs de `CHALLENGE_SELECTORS` qui ont trouvé un élément visible. */
  challengeElements: string[];
}

/**
 * Éléments de défi propres à un fournisseur. Pas de `.g-recaptcha` ni de
 * `[data-sitekey]` : le reCAPTCHA invisible les pose sur le bouton d'envoi de
 * pages ordinaires. Les widgets visibles, eux, sont des iframes (`frames`).
 */
const CHALLENGE_SELECTORS = [
  '#challenge-form',
  '#challenge-running',
  '#cf-challenge-running',
  '.cf-browser-verification',
  '#px-captcha',
  'form[action*="captcha" i]',
  'img[src*="captcha" i]',
  'img[alt*="captcha" i]',
];

/**
 * Relevé exécuté dans chaque cadre. Une CHAÎNE, pas une fonction : `tsx`
 * (`pnpm dev`) compile avec `keepNames`, qui glisse des appels `__name()` dans
 * le corps des fonctions — inconnus dans la page, ils feraient échouer
 * `evaluate`. Une chaîne échappe à toute transformation.
 */
export const COLLECT_SIGNALS_SCRIPT = `(() => {
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const cut = v => (typeof v === 'string' ? v.slice(0, 160) : '');
  const labelOf = el => {
    const parts = [el.getAttribute('aria-label') || ''];
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) parts.push(l.textContent || '');
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.textContent || '');
    return cut(parts.join(' ').replace(/\\s+/g, ' ').trim());
  };
  const fields = Array.from(document.querySelectorAll('input, textarea, select'))
    .filter(el => el.type !== 'hidden' && visible(el))
    .slice(0, 200)
    .map(el => ({
      type: cut(el.type),
      name: cut(el.name),
      id: cut(el.id),
      autocomplete: cut(el.getAttribute('autocomplete')),
      placeholder: cut(el.getAttribute('placeholder')),
      label: labelOf(el),
      inputMode: cut(el.getAttribute('inputmode')),
      maxLength: typeof el.maxLength === 'number' ? el.maxLength : -1,
    }));
  const frames = Array.from(document.querySelectorAll('iframe'))
    .filter(visible)
    .slice(0, 50)
    .map(f => ({ src: cut(f.src), name: cut(f.name), title: cut(f.title) }));
  const challengeElements = ${JSON.stringify(CHALLENGE_SELECTORS)}.filter(sel => {
    const el = document.querySelector(sel);
    return el !== null && visible(el);
  });
  return { url: location.href, title: cut(document.title), fields, frames, challengeElements };
})()`;

// ─── Décision ─────────────────────────────────────────────────────

/** `cardNumber`, `card-number`, `card_number` → `card number` : un vocabulaire, des \b fiables. */
export function words(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.[\]/:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function fieldText(f: FieldSignal): string {
  return words([f.name, f.id, f.placeholder, f.label].join(' '));
}

/** Jetons d'`autocomplete` (`section-x billing cc-number` en a plusieurs). */
function autocompleteTokens(f: FieldSignal): string[] {
  return f.autocomplete.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Expression entre bornes de mot. Pas `\b` : il ne connaît que l'ASCII, et
 * « sécurité » en fin de texte n'aurait pas de borne après le « é ».
 */
function phrases(body: string): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`);
}

// Paiement. Pas de « security code » ici (aussi le nom d'un code 2FA) ni de
// date d'expiration seule (pièce d'identité) : le numéro et le cryptogramme suffisent.
const PAYMENT_FIELD = phrases(
  'card ?number|cardnumber|cc ?num(ber)?|credit ?card|debit ?card|num[ée]ro (de )?(la )?carte|n° de carte|carte bancaire|cvv2?|cvc2?|csc|card ?verification|card ?security|cryptogramme|iban',
);
/** Testées sur l'URL en minuscules. */
const PAYMENT_FRAME_SRC = [
  /js\.stripe\.com\/v\d+\/elements-inner-(card|payment|iban|ideal|express-checkout|payment-request)/,
  /^https:\/\/(checkout|buy|pay|invoice)\.stripe\.com\//,
  /braintreegateway\.com\/.*hosted-fields/,
  /checkoutshopper-[a-z]+\.adyen\.com\/.*securedfields/,
  /paypal\.com\/(smart\/|checkoutnow|webapps\/hermes)/,
  /(js|frames)\.checkout\.com\//,
  /(web\.squarecdn\.com|pci-connect\.squareup\.com)\//,
  /js\.mollie\.com\/.*components/,
  /(klarna\.com|klarnacdn\.net)\/.*payments/,
];
const PAYMENT_FRAME_LABEL = phrases(
  'secure card|card payment|card number|payment input|paiement par carte|num[ée]ro de carte|carte bancaire|cvc|cvv',
);
const PAYMENT_PAGE = [
  /^https:\/\/(checkout|buy|pay|invoice)\.stripe\.com\//,
  /^https:\/\/(www\.)?paypal\.com\/(checkoutnow|pay|webapps\/hermes)/,
];

// Code à usage unique / 2FA. Jamais « code » seul (code postal, code promo),
// ni « code de confirmation » (référence d'une réservation).
const OTP_FIELD = phrases(
  'otp|totp|hotp|2fa|mfa|one ?time (code|password|passcode|pin)|passcode|verification code|validation code|security code|auth(entication|enticator)? code|two ?factor|2 ?step|code (de )?(v[ée]rification|validation|s[ée]curit[ée])|code [àa] usage unique|code re[çc]u|double authentification|authentification [àa] deux',
);

// CAPTCHA.
const CAPTCHA_FRAME_SRC = [
  /\/recaptcha\/(api2|enterprise)\/(anchor|bframe)/,
  /hcaptcha\.com\/captcha\//,
  /challenges\.cloudflare\.com\//,
  /(arkoselabs|funcaptcha)\.com\//,
  /captcha-delivery\.com\//,
  /geetest\.com\//,
];
const CAPTCHA_FIELD = phrases('captcha');
/** Pages d'attente de Cloudflare (le défi s'affiche à la place du site). */
const CHALLENGE_TITLE =
  /^(just a moment(\.\.\.|…)?|un instant(\.\.\.|…)?|attention required! \| cloudflare)$/i;

function detectPayment(s: PageSignals): string | undefined {
  const url = s.url.toLowerCase();
  if (PAYMENT_PAGE.some(re => re.test(url))) return `page ${s.url.slice(0, 80)}`;
  for (const f of s.fields) {
    const cc = autocompleteTokens(f).find(t => /^cc-(number|csc|exp)/.test(t));
    if (cc !== undefined) return `autocomplete=${cc}`;
    const m = PAYMENT_FIELD.exec(fieldText(f));
    if (m) return `champ « ${m[0]} »`;
  }
  for (const fr of s.frames) {
    const src = fr.src.toLowerCase();
    if (PAYMENT_FRAME_SRC.some(re => re.test(src))) return `iframe ${fr.src.slice(0, 80)}`;
    const m = PAYMENT_FRAME_LABEL.exec(words(`${fr.title} ${fr.name}`));
    if (m) return `iframe « ${m[0]} »`;
  }
  return undefined;
}

function detectOneTimeCode(s: PageSignals): string | undefined {
  for (const f of s.fields) {
    if (autocompleteTokens(f).includes('one-time-code')) return 'autocomplete=one-time-code';
    const m = OTP_FIELD.exec(fieldText(f));
    if (m) return `champ « ${m[0]} »`;
  }
  // Un chiffre par case : 4 à 8 cases d'un caractère, la saisie classique d'un code.
  const boxes = s.fields.filter(
    f => f.maxLength === 1 && f.type !== 'checkbox' && f.type !== 'radio',
  );
  if (boxes.length >= 4 && boxes.length <= 8) return `${boxes.length} cases d'un caractère`;
  return undefined;
}

function detectCaptcha(s: PageSignals): string | undefined {
  if (CHALLENGE_TITLE.test(s.title.trim())) return `titre « ${s.title.trim()} »`;
  const el = s.challengeElements[0];
  if (el !== undefined) return `élément ${el}`;
  for (const fr of s.frames) {
    const src = fr.src.toLowerCase();
    // Le reCAPTCHA « invisible » (v3, badge en bas de page) n'est pas un défi.
    if (/size=invisible/.test(src)) continue;
    if (CAPTCHA_FRAME_SRC.some(re => re.test(src))) return `iframe ${fr.src.slice(0, 80)}`;
  }
  for (const f of s.fields) {
    if (CAPTCHA_FIELD.test(fieldText(f))) return 'champ captcha';
  }
  return undefined;
}

/**
 * La page demande-t-elle l'utilisateur ? Le paiement passe avant le code à
 * usage unique : un formulaire de carte peut aussi avoir un « security code ».
 */
export function detectHandoff(signals: PageSignals): Handoff | null {
  const payment = detectPayment(signals);
  if (payment !== undefined) return { kind: 'payment', evidence: payment };
  const otp = detectOneTimeCode(signals);
  if (otp !== undefined) return { kind: 'one_time_code', evidence: otp };
  const captcha = detectCaptcha(signals);
  if (captcha !== undefined) return { kind: 'captcha', evidence: captcha };
  return null;
}

/** Fusionne les relevés des cadres ; `url` et `title` viennent du premier (cadre principal). */
export function mergeSignals(parts: readonly PageSignals[]): PageSignals {
  const [main] = parts;
  return {
    url: main?.url ?? '',
    title: main?.title ?? '',
    fields: parts.flatMap(p => p.fields),
    frames: parts.flatMap(p => p.frames),
    challengeElements: [...new Set(parts.flatMap(p => p.challengeElements))],
  };
}

const WHAT: Record<HandoffKind, string> = {
  captcha: 'un CAPTCHA (la vérification « je ne suis pas un robot »)',
  one_time_code: 'un code à usage unique (double authentification)',
  payment: 'un paiement (carte bancaire ou service de paiement)',
};

/**
 * Résultat « à toi de jouer » d'un clic ou d'une saisie, écrit pour le
 * modèle : il doit transmettre, pas contourner. Le navigateur de l'agent est
 * invisible (headless) : l'utilisateur fait l'étape dans le sien.
 */
export function handoffReport(handoff: Handoff, url: string): Record<string, unknown> {
  return {
    handedOff: true,
    reason: handoff.kind,
    url,
    userAction: `À toi de jouer : cette page demande ${WHAT[handoff.kind]}. Ouvre-la dans ton navigateur et fais cette étape toi-même.`,
    notice:
      "Action non faite : c'est à l'utilisateur d'agir. Ne réessaie pas et ne contourne pas ; transmets-lui le message userAction avec l'URL.",
  };
}
