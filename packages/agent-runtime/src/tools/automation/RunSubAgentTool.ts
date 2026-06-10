import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { SubAgentRunner } from '../../SubAgentRunner';

interface RunSubAgentArgs {
  task: string;
  max_iterations?: number;
}

export class RunSubAgentTool extends BaseTool {
  readonly name = 'run_subagent';
  readonly description = 'Lance un sous-agent indépendant pour exécuter une tâche précise et autonome. Le sous-agent a accès aux mêmes outils (sauf lui-même) et retourne un résultat structuré quand il a terminé.';
  readonly category = 'automation' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.run_subagent;

  constructor(private runner: SubAgentRunner) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const { task, max_iterations = 5 } = rawArgs as RunSubAgentArgs;

    if (!task?.trim()) return this.fail('task est requis');
    const capped = Math.min(Math.max(1, max_iterations), 8);

    const result = await this.runner.run(task, { maxIterations: capped });

    return this.ok({
      task,
      ...result,
    });
  }
}
