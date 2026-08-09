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
  it('sorts by severity and caps at five per repo', () => {
    const alerts = [
      { severity: 'LOW', pkg: 'p1' }, { severity: 'CRITICAL', pkg: 'p2' },
      { severity: 'MODERATE', pkg: 'p3' }, { severity: 'HIGH', pkg: 'p4' },
      { severity: 'LOW', pkg: 'p5' }, { severity: 'LOW', pkg: 'p6' },
    ];
    const data = vulnsModule.graphql!.map(resp([repo('widgetlib', alerts)]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    expect(slice.items).toHaveLength(5);
    expect(slice.items[0].badge?.text).toBe('critical');
    expect(slice.items[0].badge?.tone).toBe('crit');
    expect(slice.items[1].badge?.text).toBe('high');
  });

  it('tile totals all alerts and notes criticals', () => {
    const data = vulnsModule.graphql!.map(resp([
      repo('widgetlib', [{ severity: 'CRITICAL', pkg: 'lodash' }]),
      repo('parsekit', [{ severity: 'HIGH', pkg: 'undici' }, { severity: 'MODERATE', pkg: 'semver' }]),
    ]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    expect(slice.tile).toMatchObject({ n: 3, note: '1 critical', noteTone: 'crit' });
  });

  it('links rows to the repo dependabot page', () => {
    const data = vulnsModule.graphql!.map(resp([repo('widgetlib', [{ severity: 'HIGH', pkg: 'undici' }])]), undefined);
    const { slice } = vulnsModule.derive(data, undefined, NOW);
    expect(slice.items[0].href).toBe('https://github.com/cgallopo/widgetlib/security/dependabot');
  });

  it('empty state when nothing is vulnerable', () => {
    const { slice } = vulnsModule.derive({ repos: [], nextCursor: null }, undefined, NOW);
    expect(slice.status).toBe('empty');
  });
});
