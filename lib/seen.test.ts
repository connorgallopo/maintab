import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applySeen, pillFor, markSeen } from './seen';
import type { SeenStore } from './seen';
import { modulesItem } from './storage';

const NOW = 1_800_000_000_000;

describe('applySeen', () => {
  it('records silent markers on first sight and sets the baseline', () => {
    const { marks, next } = applySeen(undefined, [{ id: 'a', total: 4, createdAt: NOW - 1, flagNew: true }], NOW);
    expect(marks.a).toEqual({ unread: 0, isNew: false });
    expect(next.baselineAt).toBe(NOW);
    expect(next.seen.a).toEqual({ total: 4, seenAt: NOW });
  });

  it('reports unread as total minus marker', () => {
    const store: SeenStore = { baselineAt: NOW - 100, seen: { a: { total: 4, seenAt: NOW - 50 } } };
    const { marks } = applySeen(store, [{ id: 'a', total: 7, createdAt: 0, flagNew: false }], NOW);
    expect(marks.a).toEqual({ unread: 3, isNew: false });
  });

  it('clamps the marker down when the total shrank', () => {
    const store: SeenStore = { baselineAt: NOW - 100, seen: { a: { total: 10, seenAt: NOW - 50 } } };
    const first = applySeen(store, [{ id: 'a', total: 9, createdAt: 0, flagNew: false }], NOW);
    expect(first.marks.a).toEqual({ unread: 0, isNew: false });
    expect(first.next.seen.a!.total).toBe(9);
    const second = applySeen(first.next, [{ id: 'a', total: 10, createdAt: 0, flagNew: false }], NOW);
    expect(second.marks.a!.unread).toBe(1);
  });

  it('flags an unmarked item created after the baseline as new and leaves it unmarked', () => {
    const store: SeenStore = { baselineAt: NOW - 100, seen: {} };
    const { marks, next } = applySeen(store, [{ id: 'b', total: 0, createdAt: NOW - 10, flagNew: true }], NOW);
    expect(marks.b).toEqual({ unread: 0, isNew: true });
    expect(next.seen.b).toBeUndefined();
  });

  it('does not flag new when the card opts out or the item predates the baseline', () => {
    const store: SeenStore = { baselineAt: NOW - 100, seen: {} };
    const { marks } = applySeen(store, [
      { id: 'old', total: 2, createdAt: NOW - 500, flagNew: true },
      { id: 'mine', total: 2, createdAt: NOW - 10, flagNew: false },
    ], NOW);
    expect(marks.old).toEqual({ unread: 0, isNew: false });
    expect(marks.mine).toEqual({ unread: 0, isNew: false });
  });

  it('prunes markers for items no longer present', () => {
    const store: SeenStore = { baselineAt: NOW - 100, seen: { gone: { total: 1, seenAt: 1 }, a: { total: 1, seenAt: 1 } } };
    const { next } = applySeen(store, [{ id: 'a', total: 1, createdAt: 0, flagNew: false }], NOW);
    expect(next.seen.gone).toBeUndefined();
    expect(next.seen.a).toBeDefined();
  });
});

describe('pillFor', () => {
  it('maps marks to pill text', () => {
    expect(pillFor(undefined)).toBeUndefined();
    expect(pillFor({ unread: 0, isNew: false })).toBeUndefined();
    expect(pillFor({ unread: 3, isNew: false })).toEqual({ text: '3 new' });
    expect(pillFor({ unread: 0, isNew: true })).toEqual({ text: 'new' });
  });
});

describe('markSeen', () => {
  beforeEach(() => fakeBrowser.reset());

  it('writes the marker from the row and clears its pill', async () => {
    const data: SeenStore = { baselineAt: NOW - 100, seen: { a: { total: 2, seenAt: 1 } } };
    await modulesItem.setValue({
      x: {
        v: 1,
        data,
        slice: {
          status: 'ok', headerHref: '', headerLabel: '',
          items: [
            { id: 'a', href: '', primary: 'p', pill: { text: '4 new' }, mark: { total: 6 } },
            { id: 'b', href: '', primary: 'q', pill: { text: 'new' }, mark: { total: 1 } },
          ],
        },
      },
    });
    await markSeen('x', 'a', NOW);
    const state = await modulesItem.getValue();
    const stored = state.x!.data as SeenStore;
    expect(stored.seen.a).toEqual({ total: 6, seenAt: NOW });
    expect(stored.baselineAt).toBe(NOW - 100);
    expect(state.x!.slice.items[0]!.pill).toBeUndefined();
    expect(state.x!.slice.items[1]!.pill).toEqual({ text: 'new' });
  });

  it('ignores rows without a mark and unknown modules', async () => {
    await modulesItem.setValue({
      x: { v: 1, data: { baselineAt: 0, seen: {} }, slice: { status: 'ok', headerHref: '', headerLabel: '', items: [{ id: 'a', href: '', primary: 'p' }] } },
    });
    await markSeen('x', 'a', NOW);
    await markSeen('nope', 'a', NOW);
    const state = await modulesItem.getValue();
    expect((state.x!.data as SeenStore).seen).toEqual({});
  });
});
