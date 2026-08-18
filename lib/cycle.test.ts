import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { runCycle, AUTH_BACKOFF_MS, ERROR_BACKOFF_MS } from './cycle';
import { configItem, syncItem, modulesItem, reposItem } from './storage';
import { scopeKey } from './scope';
import * as github from './github';

const NOW = 1_800_000_000_000;

const ROOT = {
  viewer: { login: 'me' },
  prsInv: { issueCount: 0, nodes: [] },
  prsRev: { issueCount: 0, nodes: [] },
};
const DISCOVERY = { viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };

function stubGithub(overrides: { root?: unknown; discovery?: unknown; batch?: unknown } = {}) {
  const spy = vi.spyOn(github, 'graphql').mockImplementation(async (_pat, query) => {
    if (query.includes('fragment RepoFields')) return overrides.batch ?? {};
    if (query.includes('viewer { repositories(')) return overrides.discovery ?? DISCOVERY;
    return overrides.root ?? ROOT;
  });
  vi.spyOn(github, 'restGet').mockResolvedValue({ status: 200, json: [], lastModified: 'lm', pollInterval: 60 });
  return spy;
}

beforeEach(async () => {
  fakeBrowser.reset();
  await configItem.setValue({ ...(await configItem.getValue()), pat: 'tok' });
});
afterEach(() => vi.restoreAllMocks());

describe('runCycle', () => {
  it('idles without a token', async () => {
    await configItem.setValue({ ...(await configItem.getValue()), pat: '' });
    expect(await runCycle(NOW)).toBe('no-token');
  });

  it('writes all enabled module slices, records the login and clears the lock on success', async () => {
    stubGithub();
    expect(await runCycle(NOW)).toBe('ok');
    const state = await modulesItem.getValue();
    expect(Object.keys(state).sort()).toEqual(['notifications', 'prs', 'stars', 'vulns']);
    const sync = await syncItem.getValue();
    expect(sync.lastSyncAt).toBe(NOW);
    expect(sync.inFlightSince).toBe(0);
    expect(sync.authError).toBe(false);
    expect(sync.login).toBe('me');
    expect(sync.lastError).toBeNull();
  });

  it('asks for the viewer login in the root query', async () => {
    const spy = stubGithub();
    await runCycle(NOW);
    expect(spy.mock.calls[0]![1]).toContain('viewer { login }');
  });

  it('skips disabled modules entirely and drops their stored state', async () => {
    const config = await configItem.getValue();
    await configItem.setValue({ ...config, modules: { ...config.modules, stars: { enabled: true, trackedRepos: ['a/b'] } } });
    let spy = stubGithub({ root: { ...ROOT, s0: { stargazerCount: 3 } } });
    await runCycle(NOW);
    expect(spy.mock.calls[0]![1]).toContain('stargazerCount');
    expect(Object.keys(await modulesItem.getValue()).sort()).toEqual(['notifications', 'prs', 'stars', 'vulns']);

    vi.restoreAllMocks();
    await configItem.setValue({ ...config, modules: { ...config.modules, stars: { enabled: false, trackedRepos: ['a/b'] } } });
    spy = stubGithub();
    await runCycle(NOW + 1);
    expect(spy.mock.calls[0]![1]).not.toContain('stargazerCount');
    expect(Object.keys(await modulesItem.getValue()).sort()).toEqual(['notifications', 'prs', 'vulns']);
  });

  it('discovers repos, batch-fetches them with every enabled module\'s repo fields, and hands nodes to mapRepos', async () => {
    const spy = stubGithub({
      discovery: { viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        { nameWithOwner: 'me/app', url: 'https://github.com/me/app', isPrivate: false, viewerPermission: 'ADMIN' },
      ] } } },
      batch: { r0: {
        nameWithOwner: 'me/app', url: 'https://github.com/me/app', isPrivate: false, viewerPermission: 'ADMIN',
        vulnAlerts: { totalCount: 1, nodes: [{ number: 1, createdAt: '2026-01-01T00:00:00Z', securityVulnerability: { severity: 'HIGH', package: { name: 'undici' } } }] },
      } },
    });
    expect(await runCycle(NOW)).toBe('ok');
    const batchCall = spy.mock.calls.find(([, q]) => q.includes('fragment RepoFields'))!;
    expect(batchCall[1]).toContain('vulnAlerts: vulnerabilityAlerts');
    expect(batchCall[1]).toContain('r0: repository(owner: "me", name: "app")');
    const state = await modulesItem.getValue();
    expect(state.vulns!.slice.items[0]!.repo).toBe('app');
    expect((await reposItem.getValue()).scopeKey).toBe(scopeKey((await configItem.getValue()).repos));
  });

  it('coalesces while a live lock is held', async () => {
    stubGithub();
    await syncItem.setValue({ ...(await syncItem.getValue()), inFlightSince: NOW - 10_000 });
    expect(await runCycle(NOW)).toBe('in-flight');
    expect(github.graphql).not.toHaveBeenCalled();
  });

  it('reclaims a stale lock', async () => {
    stubGithub();
    await syncItem.setValue({ ...(await syncItem.getValue()), inFlightSince: NOW - 300_000 });
    expect(await runCycle(NOW)).toBe('ok');
  });

  it('respects backoff', async () => {
    stubGithub();
    await syncItem.setValue({ ...(await syncItem.getValue()), backoffUntil: NOW + 60_000 });
    expect(await runCycle(NOW)).toBe('backoff');
    expect(github.graphql).not.toHaveBeenCalled();
  });

  it('clears a stale lock while backing off, so the page stops showing sync', async () => {
    stubGithub();
    await syncItem.setValue({
      ...(await syncItem.getValue()),
      backoffUntil: NOW + 60_000,
      inFlightSince: NOW - 300_000,
    });
    expect(await runCycle(NOW)).toBe('backoff');
    expect((await syncItem.getValue()).inFlightSince).toBe(0);
    expect(github.graphql).not.toHaveBeenCalled();
  });

  it('keeps a live lock even while backing off', async () => {
    stubGithub();
    await syncItem.setValue({
      ...(await syncItem.getValue()),
      backoffUntil: NOW + 60_000,
      inFlightSince: NOW - 10_000,
    });
    expect(await runCycle(NOW)).toBe('in-flight');
    expect((await syncItem.getValue()).inFlightSince).toBe(NOW - 10_000);
  });

  it('resolves to error without mutating storage when a pre-flight read throws', async () => {
    vi.spyOn(configItem, 'getValue').mockRejectedValue(new Error('Extension context invalidated'));
    const before = await syncItem.getValue();
    expect(await runCycle(NOW)).toBe('error');
    expect(await syncItem.getValue()).toEqual(before);
  });

  it('persists backoff and lastError from a rate limit error', async () => {
    vi.spyOn(github, 'graphql').mockRejectedValue(new github.GhRateLimitError(NOW + 120_000));
    expect(await runCycle(NOW)).toBe('error');
    const sync = await syncItem.getValue();
    expect(sync.backoffUntil).toBe(NOW + 120_000);
    expect(sync.inFlightSince).toBe(0);
    expect(sync.lastError).toBe('rate-limit');
  });

  it('backs off generic errors instead of retrying every tick', async () => {
    const spy = vi.spyOn(github, 'graphql').mockRejectedValue(new Error('boom'));
    expect(await runCycle(NOW)).toBe('error');
    const sync = await syncItem.getValue();
    expect(sync.backoffUntil).toBe(NOW + ERROR_BACKOFF_MS);
    expect(sync.lastError).toBe('error');
    expect(await runCycle(NOW + 1000)).toBe('backoff');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('flags auth errors, backs off, and keeps old module data', async () => {
    stubGithub();
    await runCycle(NOW);
    vi.restoreAllMocks();
    vi.spyOn(github, 'graphql').mockRejectedValue(new github.GhAuthError('bad'));
    expect(await runCycle(NOW + 600_000)).toBe('auth-error');
    const sync = await syncItem.getValue();
    expect(sync.authError).toBe(true);
    expect(sync.lastError).toBe('auth');
    expect(sync.backoffUntil).toBe(NOW + 600_000 + AUTH_BACKOFF_MS);
    expect(Object.keys(await modulesItem.getValue())).toHaveLength(4);
    expect(await runCycle(NOW + 600_001)).toBe('backoff');
  });

  it('clears authError and backoff on the next success', async () => {
    await syncItem.setValue({ ...(await syncItem.getValue()), authError: true, lastError: 'auth', backoffUntil: 0 });
    stubGithub();
    expect(await runCycle(NOW)).toBe('ok');
    const sync = await syncItem.getValue();
    expect(sync.authError).toBe(false);
    expect(sync.lastError).toBeNull();
    expect(sync.backoffUntil).toBe(0);
  });

  it('does not write modules when the token changed mid-cycle', async () => {
    vi.spyOn(github, 'graphql').mockImplementation(async (_pat, query) => {
      if (query.includes('viewer { repositories(')) {
        await configItem.setValue({ ...(await configItem.getValue()), pat: 'other' });
        return DISCOVERY;
      }
      if (query.includes('fragment RepoFields')) return {};
      return ROOT;
    });
    vi.spyOn(github, 'restGet').mockResolvedValue({ status: 200, json: [], lastModified: 'lm', pollInterval: 60 });
    expect(await runCycle(NOW)).toBe('stale');
    expect(await modulesItem.getValue()).toEqual({});
    expect((await syncItem.getValue()).inFlightSince).toBe(0);
    expect((await syncItem.getValue()).lastSyncAt).toBe(0);
  });

  it('dedupes overlapping invocations in memory', async () => {
    stubGithub();
    const [a, b] = await Promise.all([runCycle(NOW), runCycle(NOW)]);
    expect([a, b].sort()).toEqual(['in-flight', 'ok']);
    expect(github.graphql).toHaveBeenCalledTimes(2);
  });
});
