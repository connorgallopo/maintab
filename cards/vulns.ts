import type { Config, ModuleDef, Slice, Tone } from '../lib/types';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

const TONE_ORDER: readonly Tone[] = ['crit', 'warn', 'mid', 'dim'];

export interface RepoAlerts {
  repo: string;
  url: string;
  alerts: { severity: Severity; pkg: string }[];
}

export interface VulnsData {
  repos: RepoAlerts[];
  nextCursor?: string | null;
}

function fragment(_config: Config, cursor: string | null): string {
  const after = cursor ? `, after: "${cursor}"` : '';
  return `viewer {
    repositories(ownerAffiliations: [OWNER], isArchived: false, first: 100${after}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner url
        vulnerabilityAlerts(states: OPEN, first: 100) {
          totalCount
          nodes { securityVulnerability { severity package { name } } }
        }
      }
    }
  }`;
}

interface VulnsResp {
  viewer: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        nameWithOwner: string;
        url: string;
        vulnerabilityAlerts: {
          totalCount: number;
          nodes: { securityVulnerability: { severity: Severity; package: { name: string } } }[];
        };
      }[];
    };
  };
}

function map(resp: unknown, prev: VulnsData | undefined, _config?: Config): VulnsData {
  const conn = (resp as VulnsResp).viewer.repositories;
  const fresh: RepoAlerts[] = conn.nodes
    .filter((n) => n.vulnerabilityAlerts.totalCount > 0)
    .map((n) => ({
      repo: n.nameWithOwner,
      url: n.url,
      alerts: n.vulnerabilityAlerts.nodes.map((a) => ({
        severity: a.securityVulnerability.severity,
        pkg: a.securityVulnerability.package.name,
      })),
    }));
  return {
    repos: [...(prev?.repos ?? []), ...fresh],
    nextCursor: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null,
  };
}

function derive(data: VulnsData, _stored: undefined, _now: number, _config?: Config): { slice: Slice; stored: undefined } {
  const filtered = data.repos;

  const rows = filtered
    .map((r) => {
      const counts = [0, 0, 0, 0];
      for (const alert of r.alerts) {
        const idx = SEVERITY_ORDER.indexOf(alert.severity);
        if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
      }
      return {
        id: r.repo,
        href: `${r.url}/security/dependabot`,
        repo: r.repo.split('/')[1],
        primary: '',
        counts: counts.map((value, i) => ({
          value,
          tone: value === 0 ? 'dim' : (TONE_ORDER[i] ?? 'dim'),
        })),
      };
    })
    .sort((a, b) => {
      for (let i = 0; i < 4; i++) {
        const diff = (b.counts[i]?.value ?? 0) - (a.counts[i]?.value ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

  const total = filtered.reduce((n, r) => n + r.alerts.length, 0);
  const criticals = filtered.reduce((n, r) => n + r.alerts.filter((a) => a.severity === 'CRITICAL').length, 0);

  return {
    slice: {
      status: rows.length ? 'ok' : 'empty',
      emptyText: 'No open alerts',
      headerHref: 'https://github.com/notifications?query=is%3Arepository-vulnerability-alert',
      headerLabel: `Vulnerabilities (${total}) · C/H/M/L`,
      items: rows,
      tile: {
        n: total,
        label: 'Vulnerabilities',
        note: criticals ? `${criticals} critical` : undefined,
        noteTone: criticals ? 'crit' : undefined,
      },
    },
    stored: undefined,
  };
}

export const vulnsModule: ModuleDef<VulnsData, undefined> = {
  id: 'vulns',
  title: 'Vulnerabilities',
  version: 1,
  graphql: { fragment, map },
  derive,
};
