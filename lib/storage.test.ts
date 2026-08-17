import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from '#imports';
import { configItem, syncItem, modulesItem, migrateModules, CONFIG_DEFAULTS } from './storage';
import type { ModuleDef } from './types';

describe('storage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('has working fallbacks', async () => {
    const config = await configItem.getValue();
    expect(config.pat).toBe('');
    expect(config.pollMinutes).toBe(5);
    expect(config.themePin).toBe('system');
    const sync = await syncItem.getValue();
    expect(sync.inFlightSince).toBe(0);
    expect(await modulesItem.getValue()).toEqual({});
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

  it('migrates v1 config to v2 with module defaults', async () => {
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
    expect(migrated.modules.stars.trackedRepos).toEqual(['a/b']);
    expect(migrated.modules.prs).toEqual(CONFIG_DEFAULTS.modules.prs);
    expect(migrated.modules.vulns).toEqual({ ignoredRepos: [] });
  });
});
