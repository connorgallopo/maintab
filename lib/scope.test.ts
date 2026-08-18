import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as github from './github';
import { reposItem, CONFIG_DEFAULTS } from './storage';
import {
  scopeKey, discoveryQuery, discoverRepos, applyLists, ensureRepos, invalidateRepos,
  batchQuery, fetchRepoNodes, meetsPermission, REPO_BATCH, REDISCOVER_MS, BASE_REPO_FIELDS,
} from './scope';
import type { RepoRef, RepoScopeConfig } from './types';

const NOW = 1_800_000_000_000;
const scope = (o: Partial<RepoScopeConfig> = {}): RepoScopeConfig => ({ ...CONFIG_DEFAULTS.repos, ...o });
const ref = (name: string, perm: RepoRef['viewerPermission'] = 'ADMIN'): RepoRef =>
  ({ nameWithOwner: name, url: `https://github.com/${name}`, isPrivate: false, viewerPermission: perm });

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.restoreAllMocks());

describe('scopeKey', () => {
  it('depends on affiliations (order-insensitive), min permission and forks, not on lists', () => {
    const a = scopeKey(scope({ affiliations: ['COLLABORATOR', 'OWNER'], ignored: ['x/y'] }));
    const b = scopeKey(scope({ affiliations: ['OWNER', 'COLLABORATOR'], pinned: ['p/q'] }));
    expect(a).toBe(b);
    expect(scopeKey(scope({ minPermission: 'ADMIN' }))).not.toBe(a);
    expect(scopeKey(scope({ includeForks: true }))).not.toBe(a);
  });
});

describe('discoveryQuery', () => {
  it('passes both affiliation args, excludes archived, excludes forks by default, pages with after', () => {
    const q = discoveryQuery(scope(), 'c1');
    expect(q).toContain('affiliations: [OWNER, COLLABORATOR]');
    expect(q).toContain('ownerAffiliations: [OWNER, COLLABORATOR]');
    expect(q).toContain('isArchived: false');
    expect(q).toContain('isFork: false');
    expect(q).toContain('after: "c1"');
    expect(q).toContain('nodes { nameWithOwner url isPrivate viewerPermission }');
  });

  it('omits the fork filter when forks are included and after when there is no cursor', () => {
    const q = discoveryQuery(scope({ includeForks: true }), null);
    expect(q).not.toContain('isFork');
    expect(q).not.toContain('after:');
  });
});

describe('meetsPermission', () => {
  it('ranks READ < TRIAGE < WRITE < MAINTAIN < ADMIN and rejects null', () => {
    expect(meetsPermission('WRITE', 'WRITE')).toBe(true);
    expect(meetsPermission('ADMIN', 'MAINTAIN')).toBe(true);
    expect(meetsPermission('TRIAGE', 'WRITE')).toBe(false);
    expect(meetsPermission(null, 'READ')).toBe(false);
  });
});

describe('discoverRepos', () => {
  it('pages, keeps repos at or above the minimum permission, and skips null nodes', async () => {
    const spy = vi.spyOn(github, 'graphql')
      .mockResolvedValueOnce({ viewer: { repositories: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [ref('a/one', 'ADMIN'), ref('a/two', 'TRIAGE'), null] } } })
      .mockResolvedValueOnce({ viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [ref('a/three', 'WRITE')] } } });
    const out = await discoverRepos('tok', scope());
    expect(out.map((r) => r.nameWithOwner)).toEqual(['a/one', 'a/three']);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![1]).toContain('after: "c1"');
  });

  it('returns nothing without any affiliation and makes no request', async () => {
    const spy = vi.spyOn(github, 'graphql');
    expect(await discoverRepos('tok', scope({ affiliations: [] }))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('applyLists', () => {
  it('drops ignored, appends pinned once, pins win over ignore', () => {
    const out = applyLists([ref('a/one'), ref('a/two')], scope({ ignored: ['a/two', 'a/pin'], pinned: ['a/pin', 'a/one'] }));
    expect(out.map((r) => r.nameWithOwner)).toEqual(['a/one', 'a/pin']);
    expect(out[1]).toEqual({ nameWithOwner: 'a/pin', url: 'https://github.com/a/pin', isPrivate: false, viewerPermission: null });
  });
});

describe('ensureRepos', () => {
  it('discovers when the cache is empty and stores the result with the scope key', async () => {
    vi.spyOn(github, 'graphql').mockResolvedValue({ viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [ref('a/one')] } } });
    const out = await ensureRepos('tok', scope(), NOW);
    expect(out.map((r) => r.nameWithOwner)).toEqual(['a/one']);
    const cache = await reposItem.getValue();
    expect(cache.scopeKey).toBe(scopeKey(scope()));
    expect(cache.discoveredAt).toBe(NOW);
  });

  it('serves a fresh cache without a request and still applies ignore and pin lists', async () => {
    const spy = vi.spyOn(github, 'graphql');
    await reposItem.setValue({ scopeKey: scopeKey(scope()), discoveredAt: NOW - 1000, refs: [ref('a/one'), ref('a/two')] });
    const out = await ensureRepos('tok', scope({ ignored: ['a/two'], pinned: ['p/q'] }), NOW);
    expect(out.map((r) => r.nameWithOwner)).toEqual(['a/one', 'p/q']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rediscovers when the scope key changed or the cache is stale', async () => {
    const spy = vi.spyOn(github, 'graphql').mockResolvedValue({ viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } });
    await reposItem.setValue({ scopeKey: 'other', discoveredAt: NOW, refs: [ref('a/one')] });
    expect(await ensureRepos('tok', scope(), NOW)).toEqual([]);
    await reposItem.setValue({ scopeKey: scopeKey(scope()), discoveredAt: NOW - REDISCOVER_MS - 1, refs: [ref('a/one')] });
    expect(await ensureRepos('tok', scope(), NOW)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidateRepos forces the next ensureRepos to rediscover', async () => {
    await reposItem.setValue({ scopeKey: scopeKey(scope()), discoveredAt: NOW, refs: [ref('a/one')] });
    await invalidateRepos();
    const spy = vi.spyOn(github, 'graphql').mockResolvedValue({ viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } });
    await ensureRepos('tok', scope(), NOW);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('batchQuery', () => {
  it('aliases each repo and defines the RepoFields fragment once', () => {
    const q = batchQuery([ref('a/one'), ref('b/two')], `${BASE_REPO_FIELDS}\nstargazerCount`);
    expect(q).toContain('r0: repository(owner: "a", name: "one") { ...RepoFields }');
    expect(q).toContain('r1: repository(owner: "b", name: "two") { ...RepoFields }');
    expect(q).toContain('fragment RepoFields on Repository { nameWithOwner url isPrivate viewerPermission\nstargazerCount }');
    expect(q.startsWith('query {')).toBe(true);
  });
});

describe('fetchRepoNodes', () => {
  it('chunks by REPO_BATCH, maps aliases back in order, and drops null repos', async () => {
    const refs = Array.from({ length: REPO_BATCH + 2 }, (_, i) => ref(`a/r${i}`));
    const spy = vi.spyOn(github, 'graphql').mockImplementation(async (_pat, query) => {
      const out: Record<string, unknown> = {};
      const n = (query.match(/r\d+: repository/g) ?? []).length;
      for (let i = 0; i < n; i++) out[`r${i}`] = i === 1 ? null : { nameWithOwner: `x${i}`, url: 'u', isPrivate: false, viewerPermission: 'ADMIN' };
      return out;
    });
    const nodes = await fetchRepoNodes('tok', refs, BASE_REPO_FIELDS);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(nodes).toHaveLength(REPO_BATCH + 2 - 2); // one null per chunk
    expect(nodes[0]!.nameWithOwner).toBe('x0');
    expect(nodes[1]!.nameWithOwner).toBe('x2');
  });

  it('makes no request for an empty list', async () => {
    const spy = vi.spyOn(github, 'graphql');
    expect(await fetchRepoNodes('tok', [], BASE_REPO_FIELDS)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
