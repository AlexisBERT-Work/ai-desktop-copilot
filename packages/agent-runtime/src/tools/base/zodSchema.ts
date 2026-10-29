import { z } from 'zod';
import type { JSONSchemaObject } from '@catdesk/shared-types';

/**
 * Dérive le JSON Schema (format outil Ollama) d'un schéma zod — la source
 * unique des arguments d'un outil migré. Les `describe()` zod deviennent les
 * descriptions vues par le LLM : elles font partie du prompt, les soigner.
 */
export function jsonSchemaFrom(schema: z.ZodType): JSONSchemaObject {
  // `io: 'input'` : ce que le LLM peut envoyer — un champ à `.default()` reste
  // facultatif (en sortie, zod le marquerait `required`).
  const full = z.toJSONSchema(schema, {
    target: 'draft-07',
    io: 'input',
    // Parité avec zod-to-json-schema (zod 3), pour ne pas changer le prompt :
    override: ({ jsonSchema }) => {
      // zod 4 borne tout `.int()` à ±MAX_SAFE_INTEGER : du bruit pour le LLM.
      if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) delete jsonSchema.minimum;
      if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) delete jsonSchema.maximum;
      // En mode input, zod 4 n'écrit plus `additionalProperties: false` sur les
      // objets imbriqués (les clés inconnues sont de toute façon retirées).
      if (jsonSchema.properties !== undefined && jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false;
      }
    },
  }) as Record<string, unknown>;
  // Ollama attend {type, properties, required} nus, comme les TOOL_SCHEMAS historiques.
  delete full['$schema'];
  delete full['additionalProperties'];
  delete full['definitions'];
  return full as unknown as JSONSchemaObject;
}
