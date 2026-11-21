import { parse } from 'tldts';

/**
 * Site d'une URL, au sens de l'accord « pour ce site » : son domaine
 * enregistrable (eTLD+1), calculé avec la liste des suffixes publics — y
 * compris sa partie privée, pour qu'un suffixe partagé ne s'étende pas à tous
 * ses locataires : `alice.github.io` et `bob.github.io` sont deux sites, comme
 * `exemple.co.uk` et `autre.co.uk`. `www.exemple.fr` et `m.exemple.fr` suivent
 * `exemple.fr`.
 *
 * Une IP, `localhost` ou un nom sans suffixe public (intranet) sont leur propre
 * site. `undefined` hors http(s) ou si l'URL est illisible : pas d'accord par
 * site possible.
 */
export function registrableDomain(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0) return undefined;
  // IPv6 : `URL` la garde entre crochets, tldts ne la reconnaît pas ainsi.
  if (host.startsWith('[')) return host;

  const info = parse(host, { allowPrivateDomains: true });
  if (info.isIp === true) return host;
  return info.domain ?? host;
}
