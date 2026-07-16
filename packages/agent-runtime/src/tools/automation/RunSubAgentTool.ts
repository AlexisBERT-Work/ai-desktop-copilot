import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { SubAgentRunner } from '../../SubAgentRunner';

const argsSchema = z.object({
  task: z.string().min(1).describe('Task description for the sub-agent to complete autonomously'),
  context: z
    .string()
    .optional()
    .describe(
      'Curated background the sub-agent needs (relevant facts, file paths, prior findings) — pass exactly what it needs to act, not your whole conversation. The sub-agent starts fresh and only sees this.',
    ),
  max_iterations: z.number().default(5).describe('Max ReAct iterations for the sub-agent (1-8)'),
});
type Args = z.infer<typeof argsSchema>;

export class RunSubAgentTool extends BaseTool<Args> {
  readonly name = 'run_subagent';
  readonly description =
    'Lance un sous-agent indépendant pour exécuter une tâche précise et autonome. Le sous-agent a accès aux mêmes outils (sauf lui-même) et retourne un résultat structuré quand il a terminé.';
  readonly category = 'automation' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private runner: SubAgentRunner) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { task, context, max_iterations = 5 } = rawArgs;

    if (!task?.trim()) return this.fail('task est requis');
    const capped = Math.min(Math.max(1, max_iterations), 8);

    const result = await this.runner.run(task, {
      maxIterations: capped,
      ...(context?.trim() ? { context } : {}),
    });

    return this.ok({
      task,
      ...result,
    });
  }
}
