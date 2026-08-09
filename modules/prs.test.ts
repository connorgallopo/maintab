import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { prsModule, markSeen } from './prs';
import { modulesItem } from '../lib/storage';

const NOW = 1_800_000_000_000;

const pr = (id: string, commentTotal: number) => ({
  id, repo: 'cgallopo/widgetlib', number: 241, title: 'Fix retry queue race',
  url: `https://github.com/cgallopo/widgetlib/pull/${id}`, commentTotal,
});

describe('prs derive', () => {
  it('first sight of a PR shows no unread and records a marker', () => {
    const { slice, stored } = prsModule.derive({ prs: [pr('a', 4)], totalCount: 1 }, undefined, NOW);
    expect(slice.items[0].badge).toBeUndefined();
    expect(stored.seen.a.commentTotal).toBe(4);
  });

  it('new comments since marker show as unread', () => {
    const stored = { seen: { a: { commentTotal: 4, seenAt: NOW } } };
    const { slice } = prsModule.derive({ prs: [pr('a', 7)], totalCount: 1 }, stored, NOW);
    expect(slice.items[0].badge).toEqual({ kind: 'pill', text: '3 new', tone: 'accent' });
  });

  it('clamps the marker down when comments were deleted', () => {
    const stored = { seen: { a: { commentTotal: 10, seenAt: NOW } } };
    const first = prsModule.derive({ prs: [pr('a', 9)], totalCount: 1 }, stored, NOW);
    expect(first.slice.items[0].badge).toBeUndefined();
    expect(first.stored.seen.a.commentTotal).toBe(9);
    const second = prsModule.derive({ prs: [pr('a', 10)], totalCount: 1 }, first.stored, NOW);
    expect(second.slice.items[0].badge?.text).toBe('1 new');
  });

  it('prunes markers for PRs no longer open', () => {
    const stored = { seen: { gone: { commentTotal: 2, seenAt: NOW }, a: { commentTotal: 1, seenAt: NOW } } };
    const { stored: next } = prsModule.derive({ prs: [pr('a', 1)], totalCount: 1 }, stored, NOW);
    expect(next.seen.gone).toBeUndefined();
    expect(next.seen.a).toBeDefined();
  });

  it('reports truncation in the header label', () => {
    const { slice } = prsModule.derive({ prs: [pr('a', 0)], totalCount: 140 }, undefined, NOW);
    expect(slice.headerLabel).toContain('showing 1 of 140');
  });

  it('tile counts PRs with unread comments', () => {
    const stored = { seen: { a: { commentTotal: 1, seenAt: NOW } } };
    const { slice } = prsModule.derive({ prs: [pr('a', 5)], totalCount: 1 }, stored, NOW);
    expect(slice.tile).toMatchObject({ n: 1, label: 'Open PRs' });
  });

  it('empty state', () => {
    const { slice } = prsModule.derive({ prs: [], totalCount: 0 }, undefined, NOW);
    expect(slice.status).toBe('empty');
    expect(slice.emptyText).toBe('No open PRs');
  });
});

describe('markSeen', () => {
  beforeEach(() => fakeBrowser.reset());

  it('resets the marker to the rendered total', async () => {
    const { slice, stored } = prsModule.derive(
      { prs: [pr('a', 6)], totalCount: 1 },
      { seen: { a: { commentTotal: 2, seenAt: NOW } } },
      NOW,
    );
    await modulesItem.setValue({ prs: { v: 1, slice, data: stored } });
    await markSeen('a');
    const state = await modulesItem.getValue();
    const data = state.prs.data as { seen: Record<string, { commentTotal: number }> };
    expect(data.seen.a.commentTotal).toBe(6);
    expect(state.prs.slice.items[0].badge).toBeUndefined();
  });
});
