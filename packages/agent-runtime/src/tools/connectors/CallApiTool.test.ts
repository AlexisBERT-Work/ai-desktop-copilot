import { describe, it, expect } from 'vitest';
import { validateApiUrl, buildHeaders, CallApiTool, maskApiArgs } from './CallApiTool';

describe('validateApiUrl', () => {
  it('accepte https distant', () => {
    const r = validateApiUrl('https://api.example.com/v1/x');
    expect(r.ok).toBe(true);
  });

  it('accepte http localhost', () => {
    expect(validateApiUrl('http://localhost:8000/mcp').ok).toBe(true);
    expect(validateApiUrl('http://127.0.0.1:11434/api').ok).toBe(true);
  });

  it('refuse http distant', () => {
    const r = validateApiUrl('http://example.com/x');
    expect(r.ok).toBe(false);
  });

  it('refuse une URL invalide ou un protocole exotique', () => {
    expect(validateApiUrl('not a url').ok).toBe(false);
    expect(validateApiUrl('ftp://example.com').ok).toBe(false);
  });
});

describe('buildHeaders', () => {
  it('ajoute Authorization depuis le token', () => {
    const h = buildHeaders(undefined, 'abc', false);
    expect(h['Authorization']).toBe('Bearer abc');
    expect(h['Accept']).toBe('application/json');
  });

  it("n'écrase pas une Authorization fournie", () => {
    const h = buildHeaders({ Authorization: 'Basic xyz' }, 'abc', false);
    expect(h['Authorization']).toBe('Basic xyz');
  });

  it('ajoute Content-Type json seulement si body et pas déjà présent', () => {
    expect(buildHeaders(undefined, undefined, true)['Content-Type']).toBe('application/json');
    expect(buildHeaders(undefined, undefined, false)['Content-Type']).toBeUndefined();
    expect(buildHeaders({ 'content-type': 'text/xml' }, undefined, true)['content-type']).toBe(
      'text/xml',
    );
  });
});

describe('CallApiTool', () => {
  const tool = new CallApiTool();

  it('est marqué sortant (high + confirmation)', () => {
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('rejette une url vide', async () => {
    expect((await tool.run({ url: '  ' })).success).toBe(false);
  });

  it('rejette http distant', async () => {
    expect((await tool.run({ url: 'http://example.com' })).success).toBe(false);
  });
});

describe('maskApiArgs — données personnelles', () => {
  const iban = 'FR76 3000 6000 0112 3456 7890 189';

  it('corps JSON : chaînes masquées, carte en nombre devenue chaîne masquée', () => {
    const body = JSON.stringify({ iban, card: 4111111111111111, note: 'ok', n: 42 });
    const out = maskApiArgs({ url: 'https://api.exemple.fr/v1', method: 'POST', body });
    expect(JSON.parse(out.args['body'] as string)).toEqual({
      iban: '[IBAN masqué]',
      card: '[carte masquée]',
      note: 'ok',
      n: 42,
    });
  });

  it('corps JSON sans rien à masquer : envoyé à l’octet près (grands entiers compris)', () => {
    const body = '{ "id": 12345678901234567890, "nom": "Dupont" }';
    const out = maskApiArgs({ url: 'https://api.exemple.fr/v1', method: 'POST', body });
    expect(out.args['body']).toBe(body);
  });

  it('corps texte : masqué comme du texte', () => {
    const out = maskApiArgs({
      url: 'https://api.exemple.fr/v1',
      method: 'POST',
      body: `iban=${iban}`,
    });
    expect(out.args['body']).toBe('iban=[IBAN masqué]');
  });

  it('URL : un IBAN en paramètre est masqué', () => {
    const out = maskApiArgs({ url: 'https://evil.example/c?d=FR7630006000011234567890189' });
    expect(out.args['url']).toBe('https://evil.example/c?d=[IBAN masqué]');
    expect(validateApiUrl(out.args['url'] as string).ok).toBe(true);
  });

  it('URL sans donnée : laissée à l’octet près', () => {
    const url = 'https://api.exemple.fr/items?q=caf%C3%A9&page=2';
    expect(maskApiArgs({ url }).args['url']).toBe(url);
  });

  it('e-mail : signalé, pas masqué (ce n’est pas Discord)', () => {
    const out = maskApiArgs({ url: 'https://api.exemple.fr', body: '{"to":"jean@exemple.fr"}' });
    expect(out.args['body']).toBe('{"to":"jean@exemple.fr"}');
    expect(out.summary.findings).toEqual([{ kind: 'email', level: 'flagged' }]);
  });

  it('en-têtes : masqués, sauf Authorization', () => {
    const out = maskApiArgs({
      url: 'https://api.exemple.fr',
      headers: { 'X-Iban': iban, Authorization: 'Bearer FR7630006000011234567890189' },
    });
    expect(out.args['headers']).toEqual({
      'X-Iban': '[IBAN masqué]',
      Authorization: 'Bearer FR7630006000011234567890189',
    });
  });

  it('serveur local : rien n’est touché, la donnée ne sort pas du poste', () => {
    const args = { url: 'http://localhost:3000/pay', method: 'POST', body: `{"iban":"${iban}"}` };
    expect(maskApiArgs(args).args).toBe(args);
  });

  it('URL invalide : laissée à execute, qui la refusera', () => {
    const args = { url: 'pas une url', body: iban };
    expect(maskApiArgs(args).args).toBe(args);
  });

  it('prepareOutboundArgs : notice pour le dialogue', () => {
    const out = new CallApiTool().prepareOutboundArgs({
      url: 'https://api.exemple.fr',
      body: `{"iban":"${iban}"}`,
    });
    expect(out.notice).toBe('Masqué avant envoi : 1 IBAN.');
  });
});
