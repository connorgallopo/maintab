import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { prsModule, markSeen } from './prs';
import type { PrView, RevView, PrsData, PrsStored } from './prs';
import { modulesItem, CONFIG_DEFAULTS } from '../lib/storage';
import type { Config } from '../lib/types';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function config(overrides: Partial<Config['modules']['prs']> = {}): Config {
  return {
    modules: {
      ...CONFIG_DEFAULTS.modules,
      prs: { ...CONFIG_DEFAULTS.modules.prs, ...overrides },
    },
  } as Config;
}

const node = (id: string, overrides: Partial<{
  number: number; title: string; url: string; updatedAt: string;
  repository: { nameWithOwner: string };
  comments: { totalCount: number };
  reviews: { totalCount: number };
}> = {}) => ({
  id,
  number: 241,
  title: 'Fix retry queue race',
  url: `https://github.com/cgallopo/widgetlib/pull/${id}`,
  updatedAt: '2024-01-01T00:00:00Z',
  repository: { nameWithOwner: 'cgallopo/widgetlib' },
  comments: { totalCount: 2 },
  reviews: { totalCount: 1 },
  ...overrides,
});

const resp = (auth: unknown[], authTotal?: number, rev?: unknown[], revTotal?: number) => ({
  prsAuth: { issueCount: authTotal ?? auth.length, nodes: auth },
  ...(rev ? { prsRev: { issueCount: revTotal ?? rev.length, nodes: rev } } : {}),
});

const pr = (id: string, overrides: Partial<PrView> = {}): PrView => ({
  id,
  repo: 'cgallopo/widgetlib',
  number: 241,
  title: 'Fix retry queue race',
  url: `https://github.com/cgallopo/widgetlib/pull/${id}`,
  updatedAt: NOW,
  commentTotal: 0,
  ...overrides,
});

const rev = (id: string, overrides: Partial<RevView> = {}): RevView => ({
  id,
  repo: 'cgallopo/widgetlib',
  number: 99,
  title: 'Please take a look',
  url: `https://github.com/cgallopo/widgetlib/pull/${id}`,
  updatedAt: NOW,
  ...overrides,
});

const data = (prs: PrView[] = [], reviews: RevView[] = [], authTotal?: number, revTotal?: number): PrsData => ({
  prs, reviews, authTotal: authTotal ?? prs.length, revTotal: revTotal ?? reviews.length,
});

describe('fragment', () => {
  it('emits the authored-PR search with issueCount and PR fields', () => {
    const f = prsModule.graphql!.fragment(config({ includeReviewRequests: false }), null);
    expect(f).toContain('prsAuth: search(type: ISSUE, first: 50, query: "is:pr is:open author:@me sort:updated-desc")');
    expect(f).toContain('issueCount');
    expect(f).toContain('... on PullRequest');
  });

  it('adds the review-requested search only when includeReviewRequests is set', () => {
    const off = prsModule.graphql!.fragment(config({ includeReviewRequests: false }), null);
    expect(off).not.toContain('prsRev');

    const on = prsModule.graphql!.fragment(config({ includeReviewRequests: true }), null);
    expect(on).toContain(
      'prsRev: search(type: ISSUE, first: 25, query: "is:pr is:open review-requested:@me -reviewed-by:@me sort:updated-desc")',
    );
    expect(on).toContain('issueCount');
  });
});

describe('map', () => {
  it('reads both aliases into prs and reviews', () => {
    const d = prsModule.graphql!.map(resp([node('a')], 1, [node('b')], 1), undefined);
    expect(d.prs).toHaveLength(1);
    expect(d.reviews).toHaveLength(1);
    expect(d.authTotal).toBe(1);
    expect(d.revTotal).toBe(1);
  });

  it('defaults reviews and revTotal when prsRev is absent', () => {
    const d = prsModule.graphql!.map(resp([node('a')], 1), undefined);
    expect(d.reviews).toEqual([]);
    expect(d.revTotal).toBe(0);
  });

  it('parses updatedAt to epoch ms', () => {
    const d = prsModule.graphql!.map(resp([node('a', { updatedAt: '2024-01-01T00:00:00Z' })], 1), undefined);
    expect(d.prs[0]!.updatedAt).toBe(Date.parse('2024-01-01T00:00:00Z'));
  });

  it('sums comments and reviews into commentTotal', () => {
    const n = node('a', { comments: { totalCount: 3 }, reviews: { totalCount: 2 } });
    const d = prsModule.graphql!.map(resp([n], 1), undefined);
    expect(d.prs[0]!.commentTotal).toBe(5);
  });
});

describe('derive filtering', () => {
  it('drops entries older than staleDays', () => {
    const d = data([pr('fresh', { updatedAt: NOW - 1 * DAY }), pr('stale', { updatedAt: NOW - 10 * DAY })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ staleDays: 5 }));
    expect(slice.items.map((i) => i.id)).toEqual(['fresh']);
  });

  it('keeps an entry exactly at the staleDays boundary', () => {
    const d = data([pr('edge', { updatedAt: NOW - 5 * DAY })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ staleDays: 5 }));
    expect(slice.items.map((i) => i.id)).toEqual(['edge']);
  });

  it('does not filter by staleness when staleDays is 0', () => {
    const d = data([pr('old', { updatedAt: NOW - 400 * DAY })]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ staleDays: 0 }));
    expect(slice.items.map((i) => i.id)).toEqual(['old']);
  });
});

describe('review rows', () => {
  it('excludes a review row already present as authored, so it appears once as authored', () => {
    const d = data([pr('shared')], [rev('shared'), rev('other')]);
    const { slice } = prsModule.derive(d, undefined, NOW);
    expect(slice.items.map((i) => i.id)).toEqual(['shared', 'other']);
    expect(slice.items[0]!.badge).toBeUndefined();
  });

  it('carry a review tag and never an unread pill', () => {
    const d = data([], [rev('r1')]);
    const { slice } = prsModule.derive(d, undefined, NOW);
    expect(slice.items[0]!.badge).toEqual({ kind: 'tag', text: 'review', tone: 'accent' });
  });
});

describe('rows and header label', () => {
  it('orders authored PRs before reviews', () => {
    const d = data([pr('a')], [rev('r')]);
    const { slice } = prsModule.derive(d, undefined, NOW);
    expect(slice.items.map((i) => i.id)).toEqual(['a', 'r']);
  });

  it('slices combined rows to rowCap and reports showing S of T', () => {
    const d = data([pr('a'), pr('b'), pr('c')]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ rowCap: 2 }));
    expect(slice.items).toHaveLength(2);
    expect(slice.headerLabel).toBe('Open PRs (showing 2 of 3)');
  });

  it('shows at least one row even when rowCap is 0', () => {
    const d = data([pr('a'), pr('b')]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ rowCap: 0 }));
    expect(slice.items).toHaveLength(1);
  });

  it('labels the header with just the authored count when there are no reviews', () => {
    const d = data([pr('a'), pr('b')]);
    const { slice } = prsModule.derive(d, undefined, NOW);
    expect(slice.headerLabel).toBe('Open PRs (2)');
  });

  it('labels the header with authored and review counts when both are shown in full', () => {
    const d = data([pr('a')], [rev('r')]);
    const { slice } = prsModule.derive(d, undefined, NOW, config({ rowCap: 8 }));
    expect(slice.headerLabel).toBe('Open PRs (1 + 1 reviews)');
  });
});

describe('seen markers', () => {
  it('first sight of a PR shows no unread and records a marker', () => {
    const { slice, stored } = prsModule.derive(data([pr('a', { commentTotal: 4 })]), undefined, NOW);
    expect(slice.items[0]!.badge).toBeUndefined();
    expect(stored.seen.a!.commentTotal).toBe(4);
  });

  it('new comments since marker show as unread', () => {
    const stored = { seen: { a: { commentTotal: 4, seenAt: NOW } } };
    const { slice } = prsModule.derive(data([pr('a', { commentTotal: 7 })]), stored, NOW);
    expect(slice.items[0]!.badge).toEqual({ kind: 'pill', text: '3 new', tone: 'accent' });
  });

  it('clamps the marker down when comments were deleted', () => {
    const stored = { seen: { a: { commentTotal: 10, seenAt: NOW } } };
    const first = prsModule.derive(data([pr('a', { commentTotal: 9 })]), stored, NOW);
    expect(first.slice.items[0]!.badge).toBeUndefined();
    expect(first.stored.seen.a!.commentTotal).toBe(9);
    const second = prsModule.derive(data([pr('a', { commentTotal: 10 })]), first.stored, NOW);
    expect(second.slice.items[0]!.badge?.text).toBe('1 new');
  });

  it('prunes markers for PRs no longer open', () => {
    const stored = { seen: { gone: { commentTotal: 2, seenAt: NOW }, a: { commentTotal: 1, seenAt: NOW } } };
    const { stored: next } = prsModule.derive(data([pr('a', { commentTotal: 1 })]), stored, NOW);
    expect(next.seen.gone).toBeUndefined();
    expect(next.seen.a).toBeDefined();
  });

  it('are never recorded for review rows', () => {
    const { stored } = prsModule.derive(data([], [rev('r')]), undefined, NOW);
    expect(stored.seen.r).toBeUndefined();
  });
});

describe('tile', () => {
  it('counts against authTotal, not the filtered or paged rows length', () => {
    const { slice } = prsModule.derive(data([pr('a')], [], 140), undefined, NOW);
    expect(slice.tile).toMatchObject({ n: 140, label: 'Open PRs' });
  });

  it('notes the unread comment count in good tone when present', () => {
    const stored = { seen: { a: { commentTotal: 1, seenAt: NOW } } };
    const d = data([pr('a', { commentTotal: 5 })], [rev('r')], 1);
    const { slice } = prsModule.derive(d, stored, NOW);
    expect(slice.tile).toMatchObject({ note: '1 with new comments', noteTone: 'good' });
  });

  it('falls back to review request count in dim tone when nothing is unread', () => {
    const d = data([pr('a')], [rev('r1'), rev('r2')], 1);
    const { slice } = prsModule.derive(d, undefined, NOW);
    expect(slice.tile).toMatchObject({ note: '2 review requests', noteTone: 'dim' });
  });

  it('has no note when nothing is unread and there are no review requests', () => {
    const { slice } = prsModule.derive(data([pr('a')]), undefined, NOW);
    expect(slice.tile?.note).toBeUndefined();
  });
});

describe('empty state', () => {
  it('is empty with no PRs and no reviews', () => {
    const { slice } = prsModule.derive(data(), undefined, NOW);
    expect(slice.status).toBe('empty');
    expect(slice.emptyText).toBe('No open PRs');
  });
});

describe('config defaults', () => {
  it('derive with config omitted uses CONFIG_DEFAULTS.modules.prs', () => {
    const cap = CONFIG_DEFAULTS.modules.prs.rowCap;
    const prs = Array.from({ length: cap + 2 }, (_, i) => pr(`p${i}`));
    const { slice } = prsModule.derive(data(prs), undefined, NOW);
    expect(slice.items).toHaveLength(cap);
  });
});

describe('markSeen', () => {
  beforeEach(() => fakeBrowser.reset());

  it('resets the marker to the rendered total', async () => {
    const { slice, stored } = prsModule.derive(
      data([pr('a', { commentTotal: 6 })]),
      { seen: { a: { commentTotal: 2, seenAt: NOW } } },
      NOW,
    );
    await modulesItem.setValue({ prs: { v: 1, slice, data: stored } });
    await markSeen('a');
    const state = await modulesItem.getValue();
    const d = state.prs!.data as { seen: Record<string, { commentTotal: number }> };
    expect(d.seen.a!.commentTotal).toBe(6);
    expect(state.prs!.slice.items[0]!.badge).toBeUndefined();
  });

  it('leaves a review-tagged row untouched, without writing a marker', async () => {
    const { slice } = prsModule.derive(data([], [rev('r')]), undefined, NOW);
    const stored: PrsStored = { seen: { a: { commentTotal: 1, seenAt: NOW } } };
    await modulesItem.setValue({ prs: { v: 1, slice, data: stored } });
    await markSeen('r');
    const state = await modulesItem.getValue();
    const d = state.prs!.data as PrsStored;
    expect(d.seen.r).toBeUndefined();
    expect(d.seen.a).toEqual({ commentTotal: 1, seenAt: NOW });
    expect(state.prs!.slice.items[0]!.badge).toEqual({ kind: 'tag', text: 'review', tone: 'accent' });
  });
});
