import { storage } from '#imports';
import type { Config, ModulesState, ModuleDef, SyncState } from './types';

export const configItem = storage.defineItem<Config>('local:config', {
  version: 1,
  fallback: {
    pat: '',
    pollMinutes: 5,
    themePin: 'system',
    modules: { stars: { trackedRepos: [] } },
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
