import { describe, it, expect, afterEach } from 'vitest';
import { buildWebhookPayload, resolveWebhookUrl, SendWebhookMessageTool } from './SendWebhookMessageTool';

describe('buildWebhookPayload', () => {
  it('utilise `text` pour Slack', () => {
    expect(buildWebhookPayload('slack', 'hi')).toEqual({ text: 'hi' });
  });

  it('utilise `content` pour Discord et ajoute username', () => {
    expect(buildWebhookPayload('discord', 'hi', 'Bot')).toEqual({ content: 'hi', username: 'Bot' });
  });

  it('tronque le contenu Discord à 2000 caractères', () => {
    const long = 'x'.repeat(2500);
    const body = buildWebhookPayload('discord', long) as { content: string };
    expect(body.content).toHaveLength(2000);
  });
});

describe('resolveWebhookUrl', () => {
  const saved = { d: process.env['DISCORD_WEBHOOK_URL'], s: process.env['SLACK_WEBHOOK_URL'] };
  afterEach(() => {
    process.env['DISCORD_WEBHOOK_URL'] = saved.d;
    process.env['SLACK_WEBHOOK_URL'] = saved.s;
  });

  it('préfère l\'argument', () => {
    expect(resolveWebhookUrl('discord', 'https://x/y')).toBe('https://x/y');
  });

  it('retombe sur l\'env par plateforme', () => {
    process.env['SLACK_WEBHOOK_URL'] = 'https://slack/hook';
    delete process.env['DISCORD_WEBHOOK_URL'];
    expect(resolveWebhookUrl('slack')).toBe('https://slack/hook');
    expect(resolveWebhookUrl('discord')).toBe('');
  });
});

describe('SendWebhookMessageTool', () => {
  const tool = new SendWebhookMessageTool();

  it('a le bon niveau de risque (sortant)', () => {
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('rejette un message vide', async () => {
    const res = await tool.execute({ message: '   ', webhook_url: 'https://x/y' });
    expect(res.success).toBe(false);
  });

  it('rejette une URL absente', async () => {
    delete process.env['DISCORD_WEBHOOK_URL'];
    const res = await tool.execute({ message: 'hi' });
    expect(res.success).toBe(false);
  });

  it('rejette une URL non-https', async () => {
    const res = await tool.execute({ message: 'hi', webhook_url: 'http://insecure/hook' });
    expect(res.success).toBe(false);
  });
});
