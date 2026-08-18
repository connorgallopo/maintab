import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from '#imports';
import {
  configItem, syncItem, modulesItem, reposItem, migrateModules, resetAccount,
  CONFIG_DEFAULTS, SYNC_FALLBACK, REPOS_FALLBACK,
} from './storage';
import type { ModuleDef } from './types';

describe('storage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('has working fallbacks', async () => {
    const config = await configItem.getValue();
    expect(config.pat).toBe('');
    expect(config.pollMinutes).toBe(5);
    expect(config.themePin).toBe('system');
    expect(config.repos).toEqual(CONFIG_DEFAULTS.repos);
    expect(config.modules.incoming).toEqual({ enabled: true, rowCap: 8 });
    expect(config.modules.notifications.rowCap).toBe(12);
    expect(config.modules.vulns.minSeverity).toBe('LOW');
    expect(await syncItem.getValue()).toEqual(SYNC_FALLBACK);
    expect(await modulesItem.getValue()).toEqual({});
    expect(await reposItem.getValue()).toEqual(REPOS_FALLBACK);
  });

  it('migrates a module slice whose version is behind', () => {
    const def = {
      id: 'prs',
      version: 2,
      migrate: (old: unknown) => ({ upgraded: true, from: old }),
    } as unknown as ModuleDef;
    const state = {
      prs: { v: 1, slice: { status: 'ok' } as never, data: { legacy: 1 } },
    };
    const next = migrateModules(state, [def]);
    expect(next.prs!.v).toBe(2);
    expect(next.prs!.data).toEqual({ upgraded: true, from: { legacy: 1 } });
  });

  it('leaves current-version slices alone', () => {
    const def = { id: 'prs', version: 1 } as unknown as ModuleDef;
    const state = { prs: { v: 1, slice: { status: 'ok' } as never, data: { a: 1 } } };
    expect(migrateModules(state, [def]).prs!.data).toEqual({ a: 1 });
  });

  it('migrates v1 config through v2 to v3', async () => {
    interface ConfigV1 {
      pat: string; pollMinutes: number; themePin: 'system' | 'light' | 'dark';
      modules: { stars: { trackedRepos: string[] } };
    }
    const v1 = storage.defineItem<ConfigV1>('local:config', {
      version: 1,
      fallback: { pat: '', pollMinutes: 5, themePin: 'system', modules: { stars: { trackedRepos: [] } } },
    });
    await v1.setValue({ pat: 'tok', pollMinutes: 10, themePin: 'dark', modules: { stars: { trackedRepos: ['a/b'] } } });
    await configItem.migrate();
    const migrated = await configItem.getValue();
    expect(migrated.pat).toBe('tok');
    expect(migrated.pollMinutes).toBe(10);
    expect(migrated.repos).toEqual(CONFIG_DEFAULTS.repos);
    expect(migrated.modules.stars).toEqual({ enabled: true, trackedRepos: ['a/b'] });
    expect(migrated.modules.prs).toEqual(CONFIG_DEFAULTS.modules.prs);
    expect(migrated.modules.vulns).toEqual({ enabled: true, minSeverity: 'LOW' });
  });

  it('migrates v2 config to v3, merging both ignore lists into the scope', async () => {
    interface ConfigV2 {
      pat: string; pollMinutes: number; themePin: 'system' | 'light' | 'dark';
      modules: {
        prs: { ignoredRepos: string[]; includeReviewRequests: boolean; rowCap: number; staleDays: number };
        vulns: { ignoredRepos: string[] };
        stars: { trackedRepos: string[] };
      };
    }
    const v2 = storage.defineItem<ConfigV2>('local:config', {
      version: 2,
      fallback: {
        pat: '', pollMinutes: 5, themePin: 'system',
        modules: { prs: { ignoredRepos: [], includeReviewRequests: true, rowCap: 8, staleDays: 0 }, vulns: { ignoredRepos: [] }, stars: { trackedRepos: [] } },
      },
    });
    await v2.setValue({
      pat: 'tok', pollMinutes: 3, themePin: 'light',
      modules: {
        prs: { ignoredRepos: ['a/x', 'a/y'], includeReviewRequests: false, rowCap: 12, staleDays: 30 },
        vulns: { ignoredRepos: ['a/y', 'a/z'] },
        stars: { trackedRepos: ['a/b'] },
      },
    });
    await v2.setMeta({ v: 2 });
    await configItem.migrate();
    const c = await configItem.getValue();
    expect(c.repos.ignored).toEqual(['a/x', 'a/y', 'a/z']);
    expect(c.modules.prs).toEqual({ enabled: true, rowCap: 12, includeReviewRequests: false, staleDays: 30 });
    expect(c.modules.incoming).toEqual(CONFIG_DEFAULTS.modules.incoming);
    expect(c.modules.stars.trackedRepos).toEqual(['a/b']);
  });

  it('migrates v1 sync to v2, dropping pollIntervalHint', async () => {
    interface SyncV1 { lastSyncAt: number; inFlightSince: number; backoffUntil: number; pollIntervalHint: number; authError: boolean }
    const v1 = storage.defineItem<SyncV1>('local:sync', {
      version: 1,
      fallback: { lastSyncAt: 0, inFlightSince: 0, backoffUntil: 0, pollIntervalHint: 60, authError: false },
    });
    await v1.setValue({ lastSyncAt: 5, inFlightSince: 0, backoffUntil: 9, pollIntervalHint: 60, authError: true });
    await syncItem.migrate();
    expect(await syncItem.getValue()).toEqual({ lastSyncAt: 5, inFlightSince: 0, backoffUntil: 9, authError: true, login: '', lastError: null });
  });

  it('resetAccount clears cached data and sets the token last', async () => {
    await configItem.setValue({ ...(await configItem.getValue()), pat: 'old', pollMinutes: 7 });
    await modulesItem.setValue({ prs: { v: 1, slice: { status: 'ok' } as never, data: {} } });
    await syncItem.setValue({ ...SYNC_FALLBACK, lastSyncAt: 1, login: 'someone', authError: true });
    await reposItem.setValue({ scopeKey: 'k', discoveredAt: 1, refs: [{ nameWithOwner: 'a/b', url: 'u', isPrivate: false, viewerPermission: 'ADMIN' }] });

    const writes = vi.spyOn(configItem, 'setValue');
    await resetAccount('new');

    expect((await configItem.getValue()).pat).toBe('new');
    expect((await configItem.getValue()).pollMinutes).toBe(7);
    expect(await modulesItem.getValue()).toEqual({});
    expect(await syncItem.getValue()).toEqual(SYNC_FALLBACK);
    expect(await reposItem.getValue()).toEqual(REPOS_FALLBACK);
    expect(writes.mock.calls.map((c) => c[0].pat)).toEqual(['', 'new']);
    writes.mockRestore();
  });
});
