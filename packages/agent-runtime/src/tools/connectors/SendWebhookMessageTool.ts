import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

type Platform = 'discord' | 'slack';

const argsSchema = z.object({
  message: z.string().min(1).describe('Message text to post to the channel'),
  platform: z
    .enum(['discord', 'slack'])
    .default('discord')
    .describe('Which incoming-webhook format to use'),
  webhook_url: z
    .string()
    .optional()
    .describe(
      'Incoming webhook URL (falls back to DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL by platform)',
    ),
  username: z.string().optional().describe('Override the displayed sender name (Discord only)'),
});
type Args = z.infer<typeof argsSchema>;

// Build the JSON body each platform's incoming webhook expects.
export function buildWebhookPayload(
  platform: Platform,
  message: string,
  username?: string,
): Record<string, unknown> {
  if (platform === 'slack') {
    return { text: message };
  }
  // discord
  const body: Record<string, unknown> = { content: message.slice(0, 2000) };
  if (typeof username === 'string' && username.length > 0) body['username'] = username;
  return body;
}

export function resolveWebhookUrl(platform: Platform, argUrl?: string): string {
  if (typeof argUrl === 'string' && argUrl.length > 0) return argUrl;
  const envKey = platform === 'slack' ? 'SLACK_WEBHOOK_URL' : 'DISCORD_WEBHOOK_URL';
  return process.env[envKey] ?? '';
}

async function postJson(url: string, body: unknown): Promise<{ status: number; text: string }> {
  const { default: https } = await import('https');
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
          'User-Agent': 'catdesk-agent/1.0',
        },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('Webhook timeout'));
    });
    req.write(payload);
    req.end();
  });
}

export class SendWebhookMessageTool extends BaseTool<Args> {
  readonly name = 'send_webhook_message';
  readonly description =
    'Envoie un message vers un webhook entrant Discord ou Slack. Action sortante : poste sur un service externe (confirmation requise). URL via `webhook_url` ou DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL.';
  readonly category = 'web' as const;
  readonly riskLevel = 'high' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const { message, platform, username } = args;

    if (typeof message !== 'string' || message.trim().length === 0) {
      return this.fail('message est requis et ne peut pas être vide.');
    }

    const url = resolveWebhookUrl(platform, args.webhook_url);
    if (url.length === 0) {
      return this.fail(
        `URL de webhook manquante. Passe webhook_url ou définis ${platform === 'slack' ? 'SLACK_WEBHOOK_URL' : 'DISCORD_WEBHOOK_URL'}.`,
      );
    }
    if (!/^https:\/\//i.test(url)) {
      return this.fail('webhook_url doit être une URL https valide.');
    }

    const payload = buildWebhookPayload(platform, message, username);

    let res: { status: number; text: string };
    try {
      res = await postJson(url, payload);
    } catch (err) {
      return this.fail(`Échec de l'envoi au webhook: ${String(err)}`);
    }

    // Discord returns 204 No Content on success; Slack returns 200 "ok".
    if (res.status >= 200 && res.status < 300) {
      return this.ok({ platform, status: res.status, delivered: true });
    }
    return this.fail(`Le webhook a répondu ${res.status}: ${res.text.slice(0, 300)}`);
  }
}
