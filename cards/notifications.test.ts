import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationsModule, subjectWebUrl, markRead } from './notifications';
import * as github from '../lib/github';
import { configItem, modulesItem } from '../lib/storage';
import { fakeBrowser } from 'wxt/testing/fake-browser';

const NOW = 1_800_000_000_000;

describe('subjectWebUrl', () => {
  const repoUrl = 'https://github.com/cgallopo/widgetlib';

  it('maps pull request API urls', () => {
    expect(subjectWebUrl(
      { type: 'PullRequest', url: 'https://api.github.com/repos/cgallopo/widgetlib/pulls/238' },
      repoUrl,
    )).toBe('https://github.com/cgallopo/widgetlib/pull/238');
  });

  it('maps issue API urls', () => {
    expect(subjectWebUrl(
      { type: 'Issue', url: 'https://api.github.com/repos/cgallopo/widgetlib/issues/21' },
      repoUrl,
    )).toBe('https://github.com/cgallopo/widgetlib/issues/21');
  });

  it('falls back to the repo for subjects without a mappable url', () => {
    expect(subjectWebUrl({ type: 'CheckSuite', url: null }, repoUrl)).toBe(repoUrl);
  });
});

describe('fetchData', () => {
  const ctx = { pat: 'tok', config: {} as never };

  it('honors the poll interval hint by skipping early fetches', async () => {
    const spy = vi.spyOn(github, 'restGet');
    const stored = { lastModified: 'x', fetchedAt: NOW - 10_000, threads: [], pollInterval: 60 };
    const data = await notificationsModule.fetchData!(ctx, stored, NOW);
    expect(spy).not.toHaveBeenCalled();
    expect(data.changed).toBe(false);
    spy.mockRestore();
  });

  it('keeps stored threads on 304', async () => {
    const spy = vi.spyOn(github, 'restGet').mockResolvedValue({
      status: 304, json: null, lastModified: null, pollInterval: null,
    });
    const stored = {
      lastModified: 'x', fetchedAt: 0, pollInterval: 60,
      threads: [{ id: '1', repo: 'a/b', title: 't', reason: 'mention', href: 'h' }],
    };
    const data = await notificationsModule.fetchData!(ctx, stored, NOW);
    expect(data.threads).toHaveLength(1);
    expect(data.changed).toBe(false);
    spy.mockRestore();
  });

  it('maps fresh threads on 200', async () => {
    const spy = vi.spyOn(github, 'restGet').mockResolvedValue({
      status: 200,
      lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT',
      pollInterval: 60,
      json: [{
        id: '9',
        reason: 'review_requested',
        repository: { full_name: 'cgallopo/widgetlib', html_url: 'https://github.com/cgallopo/widgetlib' },
        subject: { title: 'Fix retry', type: 'PullRequest', url: 'https://api.github.com/repos/cgallopo/widgetlib/pulls/238' },
      }],
    });
    const data = await notificationsModule.fetchData!(ctx, undefined, NOW);
    expect(data.threads[0]).toEqual({
      id: '9', repo: 'cgallopo/widgetlib', title: 'Fix retry',
      reason: 'review requested', href: 'https://github.com/cgallopo/widgetlib/pull/238',
    });
    spy.mockRestore();
  });
});

describe('derive', () => {
  it('builds the slice and counts review requests in the tile note', () => {
    const threads = [
      { id: '1', repo: 'a/b', title: 'x', reason: 'review requested', href: 'h1' },
      { id: '2', repo: 'a/b', title: 'y', reason: 'mention', href: 'h2' },
    ];
    const { slice } = notificationsModule.derive({ threads, changed: true }, undefined, NOW);
    expect(slice.tile).toMatchObject({ n: 2, note: '1 review request' });
    expect(slice.items[0]!.badge).toEqual({ kind: 'tag', text: 'review requested', tone: 'dim' });
    expect(slice.headerHref).toBe('https://github.com/notifications');
  });

  it('empty state', () => {
    const { slice } = notificationsModule.derive({ threads: [], changed: true }, undefined, NOW);
    expect(slice.status).toBe('empty');
  });
});

describe('markRead', () => {
  beforeEach(() => fakeBrowser.reset());

  it('calls the thread endpoint and removes the row locally', async () => {
    const spy = vi.spyOn(github, 'restPatch').mockResolvedValue(205);
    await configItem.setValue({ ...(await configItem.getValue()), pat: 'tok' });
    const threads = [
      { id: '9', repo: 'a/b', title: 'x', reason: 'mention', href: 'h' },
      { id: '10', repo: 'a/b', title: 'y', reason: 'ci', href: 'h2' },
    ];
    const { slice, stored } = notificationsModule.derive({ threads, changed: true }, undefined, NOW);
    await modulesItem.setValue({ notifications: { v: 1, slice, data: stored } });
    await markRead('9');
    expect(spy).toHaveBeenCalledWith('tok', '/notifications/threads/9');
    const state = await modulesItem.getValue();
    expect(state.notifications!.slice.items.map((i) => i.id)).toEqual(['10']);
    expect((state.notifications!.data as { threads: unknown[] }).threads).toHaveLength(1);
    spy.mockRestore();
  });

  it('leaves state untouched when the API call fails', async () => {
    const spy = vi.spyOn(github, 'restPatch').mockRejectedValue(new Error('down'));
    await configItem.setValue({ ...(await configItem.getValue()), pat: 'tok' });
    const threads = [{ id: '9', repo: 'a/b', title: 'x', reason: 'mention', href: 'h' }];
    const { slice, stored } = notificationsModule.derive({ threads, changed: true }, undefined, NOW);
    await modulesItem.setValue({ notifications: { v: 1, slice, data: stored } });
    await expect(markRead('9')).rejects.toThrow('down');
    const state = await modulesItem.getValue();
    expect(state.notifications!.slice.items).toHaveLength(1);
    spy.mockRestore();
  });
});
