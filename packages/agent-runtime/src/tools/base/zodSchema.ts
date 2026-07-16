import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { JSONSchemaObject } from '@catdesk/shared-types';

/**
 * Dérive le JSON Schema (format outil Ollama) d'un schéma zod — la source
 * unique des arguments d'un outil migré. Les `describe()` zod deviennent les
 * descriptions vues par le LLM : elles font partie du prompt, les soigner.
 */
export function jsonSchemaFrom(schema: z.ZodType): JSONSchemaObject {
  const full = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  // Ollama attend {type, properties, required} nus, comme les TOOL_SCHEMAS historiques.
  delete full['$schema'];
  delete full['additionalProperties'];
  delete full['definitions'];
  return full as unknown as JSONSchemaObject;
}
