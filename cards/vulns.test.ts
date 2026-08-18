import { describe, it, expect } from 'vitest';
import { vulnsModule } from './vulns';
import type { VulnsData, RepoAlerts } from './vulns';
import { CONFIG_DEFAULTS } from '../lib/storage';
import type { Config, RepoNode, Severity } from '../lib/types';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const config = (minSeverity: Severity = 'LOW'): Config =>
  ({ repos: CONFIG_DEFAULTS.repos, modules: { ...CONFIG_DEFAULTS.modules, vulns: { enabled: true, minSeverity } } }) as Config;

const node = (name: string, alerts: { severity: string; pkg: string; createdAt?: string }[] | null, totalCount?: number): RepoNode => ({
  nameWithOwner: `cgallopo/${name}`,
  url: `https://github.com/cgallopo/${name}`,
  isPrivate: false,
  viewerPermission: 'ADMIN',
  vulnAlerts: alerts === null ? null : {
    totalCount: totalCount ?? alerts.length,
    nodes: alerts.map((a, i) => ({
      number: i + 1,
      createdAt: a.createdAt ?? '2026-01-01T00:00:00Z',
      securityVulnerability: { severity: a.severity, package: { name: a.pkg } },
    })),
  },
});

const alerts = (name: string, counts: [number, number, number, number], total?: number, newestAt = 0): RepoAlerts =>
  ({ repo: `cgallopo/${name}`, url: `https://github.com/cgallopo/${name}`, counts, total: total ?? counts.reduce((a, b) => a + b, 0), newestAt });

describe('repoFields', () => {
  it('asks for open alerts with severity, package, number and createdAt under a module alias', () => {
    const f = vulnsModule.repoFields!(config());
    expect(f).toContain('vulnAlerts: vulnerabilityAlerts(states: [OPEN], first: 100)');
    expect(f).toContain('totalCount');
    expect(f).toContain('number createdAt securityVulnerability { severity package { name } }');
  });
});

describe('mapRepos', () => {
  const ctx = (minSeverity: Severity = 'LOW') => ({ config: config(minSeverity), login: 'me' });

  it('skips repos with no alerts or a null connection', () => {
    const d = vulnsModule.mapRepos!([node('clean', []), node('off', null)], undefined, ctx());
    expect(d.repos).toEqual([]);
  });

  it('counts C/H/M/L, uses totalCount for the total at LOW, and records the newest alert time', () => {
    const d = vulnsModule.mapRepos!([node('widgetlib', [
      { severity: 'HIGH', pkg: 'undici', createdAt: '2026-02-01T00:00:00Z' },
      { severity: 'CRITICAL', pkg: 'lodash', createdAt: '2026-03-01T00:00:00Z' },
      { severity: 'UNKNOWN', pkg: 'x' },
    ], 150)], undefined, ctx());
    expect(d.repos[0]).toEqual({
      repo: 'cgallopo/widgetlib', url: 'https://github.com/cgallopo/widgetlib',
      counts: [1, 1, 0, 1], total: 150, newestAt: Date.parse('2026-03-01T00:00:00Z'),
    });
  });

  it('applies the severity floor and then counts only kept alerts as the total', () => {
    const d = vulnsModule.mapRepos!([
      node('a', [{ severity: 'LOW', pkg: 'x' }, { severity: 'HIGH', pkg: 'y' }], 2),
      node('b', [{ severity: 'MODERATE', pkg: 'z' }], 1),
    ], undefined, ctx('HIGH'));
    expect(d.repos).toHaveLength(1);
    expect(d.repos[0]).toMatchObject({ repo: 'cgallopo/a', counts: [0, 1, 0, 0], total: 1 });
  });
});

describe('derive', () => {
  it('emits one row per repo with counts [C, H, M, L], tones, dependabot links and a mark', () => {
    const data: VulnsData = { repos: [alerts('widgetlib', [1, 2, 0, 3])] };
    const { slice } = vulnsModule.derive(data, undefined, NOW, config());
    const row = slice.items[0]!;
    expect(row.repo).toBe('widgetlib');
    expect(row.href).toBe('https://github.com/cgallopo/widgetlib/security/dependabot');
    expect(row.counts!.map((c) => c.value)).toEqual([1, 2, 0, 3]);
    expect(row.counts!.map((c) => c.tone)).toEqual(['crit', 'warn', 'dim', 'dim']);
    expect(row.mark).toEqual({ total: 6 });
    expect(slice.headerLabel).toBe('Vulnerabilities (6) · C/H/M/L');
  });

  it('sorts by criticals, then highs, then moderates, then lows', () => {
    const data: VulnsData = { repos: [alerts('lows', [0, 0, 0, 9]), alerts('crit', [1, 0, 0, 0]), alerts('highs', [0, 3, 0, 0])] };
    const { slice } = vulnsModule.derive(data, undefined, NOW, config());
    expect(slice.items.map((i) => i.repo)).toEqual(['crit', 'highs', 'lows']);
  });

  it('tile totals across repos, turns crit when any critical, and notes the critical count', () => {
    const data: VulnsData = { repos: [alerts('a', [2, 0, 0, 0]), alerts('b', [0, 1, 1, 0])] };
    const { slice } = vulnsModule.derive(data, undefined, NOW, config());
    expect(slice.tile).toEqual({ n: 4, label: 'Vulnerabilities', tone: 'crit', note: '2 critical', noteTone: 'crit' });
  });

  it('tile has no tone or note without criticals', () => {
    const { slice } = vulnsModule.derive({ repos: [alerts('a', [0, 1, 0, 0])] }, undefined, NOW, config());
    expect(slice.tile).toEqual({ n: 1, label: 'Vulnerabilities', tone: undefined, note: undefined, noteTone: undefined });
  });

  it('shows "N new" when a repo gained alerts since the marker and "new" for a repo that started alerting after the baseline', () => {
    const stored = { baselineAt: NOW - 10 * HOUR, seen: { 'cgallopo/a': { total: 1, seenAt: NOW - HOUR } } };
    const data: VulnsData = { repos: [alerts('a', [0, 3, 0, 0]), alerts('b', [0, 0, 1, 0], 1, NOW - HOUR)] };
    const { slice, stored: next } = vulnsModule.derive(data, stored, NOW, config());
    expect(slice.items.find((i) => i.repo === 'a')!.pill).toEqual({ text: '2 new' });
    expect(slice.items.find((i) => i.repo === 'b')!.pill).toEqual({ text: 'new' });
    expect(next.seen['cgallopo/b']).toBeUndefined();
  });

  it('empty state', () => {
    const { slice } = vulnsModule.derive({ repos: [] }, undefined, NOW, config());
    expect(slice.status).toBe('empty');
    expect(slice.emptyText).toBe('No open alerts');
  });
});

describe('module', () => {
  it('is version 2 and migrates the old undefined store to a fresh seen store', () => {
    expect(vulnsModule.version).toBe(2);
    const migrated = vulnsModule.migrate!(undefined, 1);
    expect(migrated.seen).toEqual({});
    expect(migrated.baselineAt).toBeGreaterThan(0);
  });
});
