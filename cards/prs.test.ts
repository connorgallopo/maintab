import { describe, it, expect } from 'vitest';
import { prsModule } from './prs';
import type { MyPr, PrsData } from './prs';
import { CONFIG_DEFAULTS } from '../lib/storage';
import type { Config, RepoNode } from '../lib/types';
import type { PrNode } from '../lib/pr';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function config(overrides: Partial<Config['modules']['prs']> = {}): Config {
  return {
    repos: CONFIG_DEFAULTS.repos,
    modules: { ...CONFIG_DEFAULTS.modules, prs: { ...CONFIG_DEFAULTS.modules.prs, ...overrides } },
  } as Config;
}

const node = (id: string, o: Partial<PrNode & { repository: { nameWithOwner: string } }> = {}) => ({
  id, number: 241, title: 'Fix retry queue race', url: `https://github.com/cgallopo/widgetlib/pull/${id}`,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  isDraft: false, reviewDecision: null, author: { login: 'me' },
  comments: { totalCount: 2 }, reviews: { totalCount: 1 },
  commits: { nodes: [] },
  repository: { nameWithOwner: 'cgallopo/widgetlib' },
  ...o,
});

const resp = (inv: unknown[], rev?: unknown[]) => ({
  prsInv: { issueCount: inv.length, nodes: inv },
  ...(rev ? { prsRev: { issueCount: rev.length, nodes: rev } } : {}),
});

const pr = (id: string, o: Partial<MyPr> = {}): MyPr => ({
  id, repo: 'cgallopo/widgetlib', number: 241, title: 'Fix retry queue race',
  url: `https://github.com/cgallopo/widgetlib/pull/${id}`,
  createdAt: NOW - DAY, updatedAt: NOW, total: 0, author: 'me',
  isDraft: false, reviewDecision: null, ci: null, reviewRequested: false,
  ...o,
});

const data = (prs: MyPr[], o: Partial<PrsData> = {}): PrsData => ({ prs, login: 'me', maintained: [], ...o });

describe('fragment', () => {
  it('searches PRs involving me, and review requests only when enabled', () => {
    const off = prsModule.graphql!.fragment(config({ includeReviewRequests: false }), null);
    expect(off).toContain('prsInv: search(type: ISSUE, first: 50, query: "is:pr is:open involves:@me sort:updated-desc")');
    expect(off).toContain('issueCount');
    expect(off).toContain('... on PullRequest');
    expect(off).toContain('repository { nameWithOwner }');
    expect(off).not.toContain('prsRev');

    const on = prsModule.graphql!.fragment(config({ includeReviewRequests: true }), null);
    expect(on).toContain('prsRev: search(type: ISSUE, first: 25, query: "is:pr is:open review-requested:@me -reviewed-by:@me sort:updated-desc")');
  });
});

describe('map', () => {
  it('unions both searches by id and flags review requests', () => {
    const d = prsModule.graphql!.map(resp([node('a'), node('b')], [node('b'), node('c', { author: { login: 'them' } })]), undefined);
    expect(d.prs.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(d.prs.map((p) => p.reviewRequested)).toEqual([false, true, true]);
    expect(d.prs[2]!.author).toBe('them');
    expect(d.prs[0]!.repo).toBe('cgallopo/widgetlib');
    expect(d.prs[0]!.total).toBe(3);
  });

  it('starts with an empty login and maintained list', () => {
    const d = prsModule.graphql!.map(resp([]), undefined);
    expect(d).toEqual({ prs: [], login: '', maintained: [] });
  });
});

describe('mapRepos', () => {
  it('stamps the login and the maintained repo names', () => {
    const repos = [{ nameWithOwner: 'me/x' }, { nameWithOwner: 'org/y' }] as RepoNode[];
    const d = prsModule.mapRepos!(repos, data([pr('a')], { login: '' }), { config: config(), login: 'me' });
    expect(d.login).toBe('me');
    expect(d.maintained).toEqual(['me/x', 'org/y']);
    expect(d.prs).toHaveLength(1);
  });
});

describe('derive filtering', () => {
  it('keeps authored PRs and review requests anywhere, and involved PRs only outside maintained repos', () => {
    const d = data([
      pr('mine', { repo: 'me/x' }),
      pr('rev', { repo: 'me/x', author: 'them', reviewRequested: true }),
      pr('inv-maint', { repo: 'me/x', author: 'them' }),
      pr('inv-else', { repo: 'other/z', author: 'them' }),
    ], { maintained: ['me/x'] });
    const { slice } = prsModule.derive(d, undefined, NOW, config());
    expect(slice.items.map((i) => i.id).sort()).toEqual(['inv-else', 'mine', 'rev']);
  });

  it('drops entries older than staleDays and keeps the boundary', () => {
    const d = data([pr('fresh', { updatedAt: NOW - DAY }), pr('edge', { updatedAt: NOW - 5 * DAY }), pr('stale', { updatedAt: NOW - 10 * DAY })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ staleDays: 5 }));
    expect(slice.items.map((i) => i.id)).toEqual(['fresh', 'edge']);
  });

  it('does not filter by staleness when staleDays is 0', () => {
    const { slice } = prsModule.derive(data([pr('old', { updatedAt: NOW - 400 * DAY })]), undefined, NOW, config({ staleDays: 0 }));
    expect(slice.items.map((i) => i.id)).toEqual(['old']);
  });

  it('sorts by updatedAt descending', () => {
    const d = data([pr('older', { updatedAt: NOW - 3 * DAY }), pr('newer', { updatedAt: NOW - DAY })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config());
    expect(slice.items.map((i) => i.id)).toEqual(['newer', 'older']);
  });
});

describe('rows', () => {
  it('shows repo #number, title, a mark, and a status tag', () => {
    const d = data([pr('a', { reviewDecision: 'APPROVED', total: 4 })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config());
    expect(slice.items[0]).toMatchObject({
      repo: 'widgetlib #241', primary: 'Fix retry queue race', href: 'https://github.com/cgallopo/widgetlib/pull/a',
      tag: { text: 'approved', tone: 'good' }, mark: { total: 4 },
    });
  });

  it('tags review requests "review" and non-authored rows "involved"', () => {
    const d = data([pr('r', { author: 'them', reviewRequested: true }), pr('i', { repo: 'other/z', author: 'them' })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config());
    expect(slice.items.find((i) => i.id === 'r')!.tag).toEqual({ text: 'review', tone: 'accent' });
    expect(slice.items.find((i) => i.id === 'i')!.tag).toEqual({ text: 'involved', tone: 'dim' });
  });

  it('caps rows and reports showing S of T; header shows the plain count otherwise', () => {
    const d = data([pr('a'), pr('b'), pr('c')]);
    expect(prsModule.derive(d, undefined, NOW, config({ rowCap: 2 })).slice.headerLabel).toBe('My PRs (showing 2 of 3)');
    expect(prsModule.derive(d, undefined, NOW, config()).slice.headerLabel).toBe('My PRs (3)');
    expect(prsModule.derive(d, undefined, NOW, config({ rowCap: 0 })).slice.items).toHaveLength(1);
  });
});

describe('seen markers', () => {
  it('first sight of an authored PR is silent; a later comment shows N new', () => {
    const first = prsModule.derive(data([pr('a', { total: 4 })]), undefined, NOW, config());
    expect(first.slice.items[0]!.pill).toBeUndefined();
    expect(first.stored.seen.a).toEqual({ total: 4, seenAt: NOW });
    const second = prsModule.derive(data([pr('a', { total: 7 })]), first.stored, NOW + 1, config());
    expect(second.slice.items[0]!.pill).toEqual({ text: '3 new' });
  });

  it('a non-authored PR that appears after the baseline shows "new"; an authored one does not', () => {
    const stored = { baselineAt: NOW - 10 * DAY, seen: {} };
    const d = data([pr('inv', { repo: 'o/z', author: 'them', createdAt: NOW - DAY }), pr('mine', { createdAt: NOW - DAY })]);
    const { slice } = prsModule.derive(d, stored, NOW, config());
    expect(slice.items.find((i) => i.id === 'inv')!.pill).toEqual({ text: 'new' });
    expect(slice.items.find((i) => i.id === 'mine')!.pill).toBeUndefined();
  });

  it('prunes markers for PRs no longer listed', () => {
    const stored = { baselineAt: NOW, seen: { gone: { total: 2, seenAt: NOW }, a: { total: 1, seenAt: NOW } } };
    const { stored: next } = prsModule.derive(data([pr('a', { total: 1 })]), stored, NOW, config());
    expect(next.seen.gone).toBeUndefined();
    expect(next.seen.a).toBeDefined();
  });
});

describe('tile', () => {
  it('counts rows before the cap and prefers the review-request note', () => {
    const d = data([pr('a'), pr('b', { author: 'them', reviewRequested: true }), pr('c')]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ rowCap: 2 }));
    expect(slice.tile).toEqual({ n: 3, label: 'My PRs', note: '1 awaiting my review', noteTone: 'accent' });
  });

  it('falls back to the new-activity note, then no note', () => {
    const stored = { baselineAt: NOW, seen: { a: { total: 1, seenAt: NOW } } };
    const withNew = prsModule.derive(data([pr('a', { total: 5 })]), stored, NOW, config());
    expect(withNew.slice.tile).toMatchObject({ note: '1 with new activity', noteTone: 'good' });
    const quiet = prsModule.derive(data([pr('a')]), undefined, NOW, config());
    expect(quiet.slice.tile).toEqual({ n: 1, label: 'My PRs', note: undefined, noteTone: undefined });
  });
});

describe('empty state', () => {
  it('is empty with no PRs', () => {
    const { slice } = prsModule.derive(data([]), undefined, NOW, config());
    expect(slice.status).toBe('empty');
    expect(slice.emptyText).toBe('No open PRs');
    expect(slice.headerHref).toBe('https://github.com/pulls');
  });
});

describe('module', () => {
  it('is version 2 and migrates v1 seen markers to the shared shape', () => {
    expect(prsModule.version).toBe(2);
    const migrated = prsModule.migrate!({ seen: { a: { commentTotal: 3, seenAt: 5 } } }, 1);
    expect(migrated.seen).toEqual({ a: { total: 3, seenAt: 5 } });
    expect(migrated.baselineAt).toBeGreaterThan(0);
  });
});
