import { storage } from '#imports';
import type { Config, ModulesState, ModuleDef, SyncState } from './types';

export const CONFIG_DEFAULTS: { modules: Config['modules'] } = {
  modules: {
    prs: { ignoredRepos: [], includeReviewRequests: true, rowCap: 8, staleDays: 0 },
    vulns: { ignoredRepos: [] },
    stars: { trackedRepos: [] },
  },
};

export const configItem = storage.defineItem<Config>('local:config', {
  version: 2,
  fallback: {
    pat: '',
    pollMinutes: 5,
    themePin: 'system',
    modules: CONFIG_DEFAULTS.modules,
  },
  migrations: {
    2: (old: {
      pat: string; pollMinutes: number; themePin: Config['themePin'];
      modules: { stars: { trackedRepos: string[] } };
    }): Config => ({
      ...old,
      modules: {
        prs: CONFIG_DEFAULTS.modules.prs,
        vulns: CONFIG_DEFAULTS.modules.vulns,
        stars: old.modules.stars,
      },
    }),
  },
});

export const syncItem = storage.defineItem<SyncState>('local:sync', {
  version: 1,
  fallback: {
    lastSyncAt: 0,
    inFlightSince: 0,
    backoffUntil: 0,
    pollIntervalHint: 60,
    authError: false,
  },
});

export const modulesItem = storage.defineItem<ModulesState>('local:modules', {
  version: 1,
  fallback: {},
});

export function migrateModules(state: ModulesState, defs: ModuleDef[]): ModulesState {
  const next: ModulesState = { ...state };
  for (const def of defs) {
    const entry = next[def.id];
    if (entry && entry.v < def.version && def.migrate) {
      next[def.id] = { ...entry, v: def.version, data: def.migrate(entry.data, entry.v) };
    }
  }
  return next;
}
