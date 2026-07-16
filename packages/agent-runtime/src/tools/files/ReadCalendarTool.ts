import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

const argsSchema = z.object({
  path: z.string().min(1).describe('Absolute path to a local .ics (iCalendar) file'),
  from: z.string().optional().describe('Window start as YYYY-MM-DD (defaults to today)'),
  to: z.string().optional().describe('Window end as YYYY-MM-DD (defaults to from + days)'),
  days: z.number().default(30).describe('Window length in days when "to" is omitted'),
  limit: z.number().default(50).describe('Maximum number of events to return'),
});
type Args = z.infer<typeof argsSchema>;
/** Forme d'entree (avant defauts zod) - celle des helpers purs et des tests. */
type ArgsInput = z.input<typeof argsSchema>;

interface CalendarParams {
  path: string;
  days: number;
  limit: number;
  from?: string;
  to?: string;
}

/** Build the sidecar params, applying defaults. Pure — unit-testable. */
export function buildCalendarParams(args: ArgsInput): CalendarParams {
  const params: CalendarParams = {
    path: args.path,
    days: args.days ?? 30,
    limit: args.limit ?? 50,
  };
  if (args.from) params.from = args.from;
  if (args.to) params.to = args.to;
  return params;
}

interface CalendarEvent {
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string;
  description: string;
  status: string;
}

interface CalendarResult {
  path: string;
  from: string;
  to: string;
  count: number;
  truncated: boolean;
  events: CalendarEvent[];
}

/**
 * Read a local iCalendar (.ics) file and list events within a date window,
 * expanding recurring events. Fully local — no network, no credentials.
 * Defaults to the next 30 days when no window is given.
 */
export class ReadCalendarTool extends BaseTool<Args> {
  readonly name = 'read_calendar';
  readonly description =
    'Lit un fichier calendrier .ics local et liste les événements sur une fenêtre de dates (par défaut : 30 prochains jours). Développe les événements récurrents. 100% local, sans réseau ni identifiants. Fenêtre réglable via from/to (YYYY-MM-DD) ou days.';
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const args = rawArgs;

    if (!args.path?.trim()) return this.fail('path est requis (chemin du fichier .ics).');

    try {
      const result = (await OcrSidecarClient.get().call(
        'files.read_calendar',
        buildCalendarParams(args),
        60_000,
      )) as CalendarResult;

      return this.ok({
        from: result.from,
        to: result.to,
        count: result.count,
        truncated: result.truncated,
        events: result.events,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not installed') || msg.includes('No module named')) {
        return this.fail(
          'Dépendance Python manquante. Dans le sidecar : pip install icalendar recurring-ical-events',
        );
      }
      if (msg.includes('No such file') || msg.includes('Errno 2') || msg.includes('cannot find')) {
        return this.fail(`Fichier .ics introuvable : ${args.path}`);
      }
      return this.fail(`Lecture du calendrier échouée : ${msg}`);
    }
  }
}
