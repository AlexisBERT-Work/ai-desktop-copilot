import { describe, it, expect } from 'vitest';
import { validateApiUrl, buildHeaders, CallApiTool } from './CallApiTool';

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

  it('n\'écrase pas une Authorization fournie', () => {
    const h = buildHeaders({ Authorization: 'Basic xyz' }, 'abc', false);
    expect(h['Authorization']).toBe('Basic xyz');
  });

  it('ajoute Content-Type json seulement si body et pas déjà présent', () => {
    expect(buildHeaders(undefined, undefined, true)['Content-Type']).toBe('application/json');
    expect(buildHeaders(undefined, undefined, false)['Content-Type']).toBeUndefined();
    expect(buildHeaders({ 'content-type': 'text/xml' }, undefined, true)['content-type']).toBe('text/xml');
  });
});

describe('CallApiTool', () => {
  const tool = new CallApiTool();

  it('est marqué sortant (high + confirmation)', () => {
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('rejette une url vide', async () => {
    expect((await tool.execute({ url: '  ' })).success).toBe(false);
  });

  it('rejette http distant', async () => {
    expect((await tool.execute({ url: 'http://example.com' })).success).toBe(false);
  });
});
