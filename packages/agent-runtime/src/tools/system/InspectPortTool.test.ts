import { describe, it, expect } from 'vitest';
import { parseNetstat, parseTasklist } from './InspectPortTool';

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       5678
  TCP    192.168.1.5:55012      93.184.216.34:443     ESTABLISHED     999
  TCP    [::]:3000              [::]:0                LISTENING       1234
  UDP    0.0.0.0:53             *:*                                    321
`;

describe('parseNetstat', () => {
  it('garde uniquement les TCP LISTENING et déduplique', () => {
    const rows = parseNetstat(NETSTAT);
    const ports = rows.map((r) => r.port).sort((a, b) => a - b);
    // 3000 (dedup ipv4+ipv6 same pid) and 5432; ESTABLISHED excluded
    expect(ports).toEqual([3000, 5432]);
  });

  it('filtre par port', () => {
    const rows = parseNetstat(NETSTAT, 3000);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pid).toBe(1234);
  });

  it('retourne vide pour un port libre', () => {
    expect(parseNetstat(NETSTAT, 9999)).toHaveLength(0);
  });
});

describe('parseTasklist', () => {
  it('mappe pid → nom de process', () => {
    const csv = `"node.exe","1234","Console","1","120,000 K"
"postgres.exe","5678","Services","0","80,000 K"`;
    const map = parseTasklist(csv);
    expect(map.get(1234)).toBe('node.exe');
    expect(map.get(5678)).toBe('postgres.exe');
  });
});
