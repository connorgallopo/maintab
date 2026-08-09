import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { runCycle } from './cycle';
import { configItem, syncItem, modulesItem } from './storage';
import * as github from './github';

const NOW = 1_800_000_000_000;

const GQL_RESP = {
  prsAuth: { issueCount: 0, nodes: [] },
  viewer: {
    repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  },
};

function stubGithub() {
  vi.spyOn(github, 'graphql').mockResolvedValue(GQL_RESP);
  vi.spyOn(github, 'restGet').mockResolvedValue({
    status: 200, json: [], lastModified: 'lm', pollInterval: 60,
  });
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

  it('writes all module slices and clears the lock on success', async () => {
    stubGithub();
    expect(await runCycle(NOW)).toBe('ok');
    const state = await modulesItem.getValue();
    expect(Object.keys(state).sort()).toEqual(['notifications', 'prs', 'stars', 'vulns']);
    const sync = await syncItem.getValue();
    expect(sync.lastSyncAt).toBe(NOW);
    expect(sync.inFlightSince).toBe(0);
    expect(sync.authError).toBe(false);
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

  it('persists backoff from a rate limit error', async () => {
    vi.spyOn(github, 'graphql').mockRejectedValue(new github.GhRateLimitError(NOW + 120_000));
    expect(await runCycle(NOW)).toBe('error');
    const sync = await syncItem.getValue();
    expect(sync.backoffUntil).toBe(NOW + 120_000);
    expect(sync.inFlightSince).toBe(0);
  });

  it('backs off generic errors instead of retrying every tick', async () => {
    const spy = vi.spyOn(github, 'graphql').mockRejectedValue(new Error('boom'));
    expect(await runCycle(NOW)).toBe('error');
    const sync = await syncItem.getValue();
    expect(sync.backoffUntil).toBe(NOW + 60_000);
    expect(await runCycle(NOW + 1000)).toBe('backoff');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('flags auth errors and keeps old module data', async () => {
    stubGithub();
    await runCycle(NOW);
    vi.restoreAllMocks();
    vi.spyOn(github, 'graphql').mockRejectedValue(new github.GhAuthError('bad'));
    expect(await runCycle(NOW + 600_000)).toBe('auth-error');
    const sync = await syncItem.getValue();
    expect(sync.authError).toBe(true);
    expect(Object.keys(await modulesItem.getValue())).toHaveLength(4);
  });

  it('dedupes overlapping invocations in memory', async () => {
    stubGithub();
    const [a, b] = await Promise.all([runCycle(NOW), runCycle(NOW)]);
    expect([a, b].sort()).toEqual(['in-flight', 'ok']);
    expect(github.graphql).toHaveBeenCalledTimes(1);
  });

  it('follows pagination cursors', async () => {
    const page2 = { ...GQL_RESP, viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
    const page1 = { ...GQL_RESP, viewer: { repositories: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [] } } };
    const spy = vi.spyOn(github, 'graphql')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    vi.spyOn(github, 'restGet').mockResolvedValue({ status: 200, json: [], lastModified: null, pollInterval: 60 });
    expect(await runCycle(NOW)).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1]).toContain('after: "c1"');
  });
});
