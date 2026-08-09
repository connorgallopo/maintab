import type { Config, ModuleDef, Slice } from '../lib/types';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

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

function derive(data: VulnsData, _stored: undefined, _now: number): { slice: Slice; stored: undefined } {
  const rows = data.repos.flatMap((r) =>
    [...r.alerts]
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
      .slice(0, 5)
      .map((a, i) => ({
        id: `${r.repo}:${a.pkg}:${i}`,
        href: `${r.url}/security/dependabot`,
        repo: r.repo.split('/')[1],
        primary: a.pkg,
        badge: {
          kind: 'tag' as const,
          text: a.severity.toLowerCase(),
          tone: a.severity === 'CRITICAL' ? ('crit' as const) : a.severity === 'HIGH' ? ('warn' as const) : ('dim' as const),
        },
      })),
  );
  const total = data.repos.reduce((n, r) => n + r.alerts.length, 0);
  const criticals = data.repos.reduce((n, r) => n + r.alerts.filter((a) => a.severity === 'CRITICAL').length, 0);
  return {
    slice: {
      status: rows.length ? 'ok' : 'empty',
      emptyText: 'No open alerts',
      headerHref: 'https://github.com/notifications?query=is%3Arepository-vulnerability-alert',
      headerLabel: `Vulnerabilities (${total})`,
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
