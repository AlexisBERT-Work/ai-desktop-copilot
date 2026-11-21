/**
 * Ce qu'un serveur MCP écrit et qui finit dans le PROMPT : la description et le
 * schéma d'arguments de chaque outil. Deux risques, deux bornes :
 * - latence : chaque caractère est relu à chaque tour où l'outil est proposé.
 *   On garde les noms, types, `enum` et `required` ; les descriptions sont
 *   coupées, les objets imbriqués réduits à leur type ;
 * - injection (« tool poisoning ») : une description peut contenir une consigne.
 *   Elle passe par `sanitizeToolOutput` ; au moindre signal, elle est remplacée
 *   par une description neutre.
 */
import type { JSONSchemaObject, JSONSchemaProperty } from '@catdesk/shared-types';
import { sanitizeToolOutput } from '../security/sanitizeToolOutput';
import { cleanInvisible } from '../security/invisibleChars';

const MAX_TOOL_DESCRIPTION = 200;
const MAX_PROPERTY_DESCRIPTION = 100;
const MAX_PROPERTIES = 12;
const MAX_ENUM = 20;

/** Arguments qui nomment un chemin : vérifiés contre la liste blanche (comme `pathArgs`). */
export const PATH_LIKE_ARG =
  /^(path|paths|file|files|file_path|filepath|dir|directory|source|destination|output)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Texte tiers ramené à une ligne courte et sans consigne cachée, ou `undefined`. */
export function cleanThirdPartyText(text: unknown, max: number): string | undefined {
  if (typeof text !== 'string') return undefined;
  const oneLine = cleanInvisible(text).text.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return undefined;
  const scan = sanitizeToolOutput(oneLine);
  if (scan.injectionFlags.length > 0 || scan.redactions.length > 0) return undefined;
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function compactProperty(raw: unknown): JSONSchemaProperty {
  const prop = isRecord(raw) ? raw : {};
  const rawType = Array.isArray(prop['type']) ? prop['type'].find(t => t !== 'null') : prop['type'];
  const description = cleanThirdPartyText(prop['description'], MAX_PROPERTY_DESCRIPTION);
  const withDescription = description !== undefined ? { description } : {};

  switch (rawType) {
    case 'string': {
      const values = Array.isArray(prop['enum'])
        ? prop['enum'].filter((v): v is string => typeof v === 'string').slice(0, MAX_ENUM)
        : [];
      return { type: 'string', ...withDescription, ...(values.length > 0 ? { enum: values } : {}) };
    }
    case 'number':
    case 'integer':
      return { type: 'number', ...withDescription };
    case 'boolean':
      return { type: 'boolean', ...withDescription };
    case 'array':
      return { type: 'array', items: compactProperty(prop['items']), ...withDescription };
    case 'object':
      return { type: 'object' };
    default:
      // Type absent ou exotique : une chaîne est ce que le modèle sait le mieux fournir.
      return { type: 'string', ...withDescription };
  }
}

/** Schéma d'arguments réduit à ce dont le modèle a besoin pour appeler l'outil. */
export function compactInputSchema(raw: unknown): JSONSchemaObject {
  const schema = isRecord(raw) ? raw : {};
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = Array.isArray(schema['required'])
    ? schema['required'].filter((k): k is string => typeof k === 'string' && k in properties)
    : [];
  // Les obligatoires d'abord : ce sont eux qu'on ne peut pas laisser tomber.
  const names = [...required, ...Object.keys(properties).filter(k => !required.includes(k))].slice(
    0,
    Math.max(MAX_PROPERTIES, required.length),
  );

  const out: Record<string, JSONSchemaProperty> = {};
  for (const name of names) out[name] = compactProperty(properties[name]);
  return { type: 'object', properties: out, ...(required.length > 0 ? { required } : {}) };
}

/** Description vue par le modèle : celle de l'utilisateur, sinon celle du serveur nettoyée. */
export function toolDescription(
  serverId: string,
  toolName: string,
  serverText: unknown,
  userText: string | undefined,
): string {
  const chosen =
    cleanThirdPartyText(userText, MAX_TOOL_DESCRIPTION) ??
    cleanThirdPartyText(serverText, MAX_TOOL_DESCRIPTION) ??
    toolName.replace(/[_-]+/g, ' ');
  return `${chosen} (serveur MCP ${serverId})`;
}

/** Arguments de premier niveau qui désignent un chemin du disque. */
export function pathLikeArgs(schema: JSONSchemaObject): string[] {
  return Object.keys(schema.properties ?? {}).filter(k => PATH_LIKE_ARG.test(k));
}
