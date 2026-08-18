import { describe, it, expect } from 'vitest';
import { vulnsModule } from './vulns';

const NOW = 1_800_000_000_000;

const resp = (repos: unknown[], hasNext = false, cursor: string | null = null) => ({
  viewer: {
    repositories: {
      pageInfo: { hasNextPage: hasNext, endCursor: cursor },
      nodes: repos,
    },
  },
});

const repo = (name: string, alerts: { severity: string; pkg: string }[]) => ({
  nameWithOwner: `cgallopo/${name}`,
  url: `https://github.com/cgallopo/${name}`,
  vulnerabilityAlerts: {
    totalCount: alerts.length,
    nodes: alerts.map((a) => ({ securityVulnerability: { severity: a.severity, package: { name: a.pkg } } })),
  },
});

describe('map', () => {
  it('accumulates pages and carries the cursor', () => {
    const page1 = vulnsModule.graphql!.map(resp([repo('widgetlib', [{ severity: 'HIGH', pkg: 'undici' }])], true, 'c1'), undefined);
    expect(page1.nextCursor).toBe('c1');
    const page2 = vulnsModule.graphql!.map(resp([repo('parsekit', [{ severity: 'CRITICAL', pkg: 'lodash' }])]), page1);
    expect(page2.nextCursor).toBeNull();
    expect(page2.repos).toHaveLength(2);
  });

  it('skips repos with no alerts', () => {
    const data = vulnsModule.graphql!.map(resp([repo('clean', [])]), undefined);
    expect(data.repos).toHaveLength(0);
  });
});

describe('derive', () => {
  it('emits one row per repo with counts [C, H, M, L] and tones [crit, warn, mid, dim]', () => {
    const data = vulnsModule.graphql!.map(resp([
      repo('widgetlib', [
        { severity: 'CRITICAL', pkg: 'lodash' },
        { severity: 'HIGH', pkg: 'undici' },
        { severity: 'MODERATE', pkg: 'semver' },
        { severity: 'LOW', pkg: 'debug' },
      ]),
    ]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    expect(slice.items).toHaveLength(1);
    expect(slice.items[0]!.id).toBe('cgallopo/widgetlib');
    expect(slice.items[0]!.counts).toEqual([
      { value: 1, tone: 'crit' },
      { value: 1, tone: 'warn' },
      { value: 1, tone: 'mid' },
      { value: 1, tone: 'dim' },
    ]);
  });

  it('zero counts always take tone dim', () => {
    const data = vulnsModule.graphql!.map(resp([
      repo('clean-repo', [{ severity: 'CRITICAL', pkg: 'lodash' }]),
      repo('only-high', [{ severity: 'HIGH', pkg: 'undici' }, { severity: 'HIGH', pkg: 'other' }]),
    ]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    const cleanRow = slice.items.find((i) => i.repo === 'clean-repo');
    const highRow = slice.items.find((i) => i.repo === 'only-high');
    expect(cleanRow?.counts).toEqual([
      { value: 1, tone: 'crit' },
      { value: 0, tone: 'dim' },
      { value: 0, tone: 'dim' },
      { value: 0, tone: 'dim' },
    ]);
    expect(highRow?.counts).toEqual([
      { value: 0, tone: 'dim' },
      { value: 2, tone: 'warn' },
      { value: 0, tone: 'dim' },
      { value: 0, tone: 'dim' },
    ]);
  });

  it('rows sort most-severe-first: descending by [C, H, M, L]', () => {
    const data = vulnsModule.graphql!.map(resp([
      repo('low-only', [{ severity: 'LOW', pkg: 'p1' }]),
      repo('critical-and-high', [{ severity: 'CRITICAL', pkg: 'p2' }, { severity: 'HIGH', pkg: 'p3' }]),
      repo('moderate-only', [{ severity: 'MODERATE', pkg: 'p4' }]),
      repo('high-only', [{ severity: 'HIGH', pkg: 'p5' }]),
    ]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    expect(slice.items.map((i) => i.repo)).toEqual([
      'critical-and-high',
      'high-only',
      'moderate-only',
      'low-only',
    ]);
  });

  it('links rows to the repo dependabot page', () => {
    const data = vulnsModule.graphql!.map(resp([repo('widgetlib', [{ severity: 'HIGH', pkg: 'undici' }])]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    expect(slice.items[0]!.href).toBe('https://github.com/cgallopo/widgetlib/security/dependabot');
  });

  it('empty state when nothing is vulnerable', () => {
    const { slice } = vulnsModule.derive({ repos: [], nextCursor: null }, undefined, NOW);
    expect(slice.status).toBe('empty');
  });
});
