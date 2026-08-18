import type { Config, ModuleDef, RepoCtx, RepoNode, RowItem, Severity, Slice, Tone } from '../lib/types';
import { applySeen, pillFor, type SeenStore } from '../lib/seen';

const SEVERITY_ORDER: readonly Severity[] = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];
const TONE_ORDER: readonly Tone[] = ['crit', 'warn', 'mid', 'dim'];
const RANK: Record<Severity, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

export interface RepoAlerts {
  repo: string;
  url: string;
  total: number;
  counts: [number, number, number, number];
  newestAt: number;
}

export interface VulnsData {
  repos: RepoAlerts[];
}

export type VulnsStored = SeenStore;

function repoFields(_config: Config): string {
  return `vulnAlerts: vulnerabilityAlerts(states: [OPEN], first: 100) {
  totalCount
  nodes { number createdAt securityVulnerability { severity package { name } } }
}`;
}

interface AlertNode {
  number: number;
  createdAt: string;
  securityVulnerability: { severity: string; package: { name: string } } | null;
}

type VulnRepoNode = RepoNode & { vulnAlerts: { totalCount: number; nodes: AlertNode[] } | null };

function rank(severity: string): number {
  return RANK[severity as Severity] ?? 0;
}

function mapRepos(repos: RepoNode[], _prev: VulnsData | undefined, ctx: RepoCtx): VulnsData {
  const min = RANK[ctx.config.modules.vulns.minSeverity];
  const out: RepoAlerts[] = [];
  for (const r of repos as VulnRepoNode[]) {
    const conn = r.vulnAlerts;
    if (!conn || conn.totalCount === 0) continue;
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    let kept = 0;
    let newestAt = 0;
    for (const a of conn.nodes) {
      const severity = a.securityVulnerability?.severity ?? 'LOW';
      if (rank(severity) < min) continue;
      kept += 1;
      const idx = SEVERITY_ORDER.indexOf(severity as Severity);
      const slot = idx >= 0 ? idx : 3;
      counts[slot] = (counts[slot] ?? 0) + 1;
      newestAt = Math.max(newestAt, Date.parse(a.createdAt));
    }
    if (kept === 0) continue;
    out.push({ repo: r.nameWithOwner, url: r.url, total: min === 0 ? conn.totalCount : kept, counts, newestAt });
  }
  return { repos: out };
}

function derive(data: VulnsData, stored: VulnsStored | undefined, now: number, _config?: Config): { slice: Slice; stored: VulnsStored } {
  const repos = data.repos;
  const { marks, next } = applySeen(
    stored,
    repos.map((r) => ({ id: r.repo, total: r.total, createdAt: r.newestAt, flagNew: true })),
    now,
  );

  const rows: RowItem[] = repos
    .map((r) => ({
      id: r.repo,
      href: `${r.url}/security/dependabot`,
      repo: r.repo.split('/')[1] ?? r.repo,
      primary: '',
      counts: r.counts.map((value, i) => ({ value, tone: value === 0 ? 'dim' : (TONE_ORDER[i] ?? 'dim') })),
      pill: pillFor(marks[r.repo]),
      mark: { total: r.total },
    }))
    .sort((a, b) => {
      for (let i = 0; i < 4; i++) {
        const diff = (b.counts[i]?.value ?? 0) - (a.counts[i]?.value ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

  const total = repos.reduce((n, r) => n + r.total, 0);
  const criticals = repos.reduce((n, r) => n + r.counts[0], 0);

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
        tone: criticals ? 'crit' : undefined,
        note: criticals ? `${criticals} critical` : undefined,
        noteTone: criticals ? 'crit' : undefined,
      },
    },
    stored: next,
  };
}

export const vulnsModule: ModuleDef<VulnsData, VulnsStored> = {
  id: 'vulns',
  title: 'Vulnerabilities',
  version: 2,
  migrate: () => ({ baselineAt: Date.now(), seen: {} }),
  repoFields,
  mapRepos,
  derive,
};
