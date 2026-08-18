import { storage } from '#imports';
import type { Config, ModulesState, ModuleDef, ReposCache, SyncState } from './types';

export const CONFIG_DEFAULTS: Pick<Config, 'repos' | 'modules'> = {
  repos: { affiliations: ['OWNER', 'COLLABORATOR'], minPermission: 'WRITE', includeForks: false, ignored: [], pinned: [] },
  modules: {
    incoming: { enabled: true, rowCap: 8 },
    prs: { enabled: true, rowCap: 8, includeReviewRequests: true, staleDays: 0 },
    issues: { enabled: true, rowCap: 8, includeInvolved: true },
    notifications: { enabled: true, rowCap: 12, hideReasons: [], participatingOnly: false },
    vulns: { enabled: true, minSeverity: 'LOW' },
    builds: { enabled: true },
    stars: { enabled: true, trackedRepos: [] },
  },
};

interface ConfigV1 {
  pat: string; pollMinutes: number; themePin: Config['themePin'];
  modules: { stars: { trackedRepos: string[] } };
}

interface ConfigV2 {
  pat: string; pollMinutes: number; themePin: Config['themePin'];
  modules: {
    prs: { ignoredRepos: string[]; includeReviewRequests: boolean; rowCap: number; staleDays: number };
    vulns: { ignoredRepos: string[] };
    stars: { trackedRepos: string[] };
  };
}

export const configItem = storage.defineItem<Config>('local:config', {
  version: 3,
  fallback: {
    pat: '',
    pollMinutes: 5,
    themePin: 'system',
    repos: CONFIG_DEFAULTS.repos,
    modules: CONFIG_DEFAULTS.modules,
  },
  migrations: {
    2: (old: ConfigV1): ConfigV2 => ({
      ...old,
      modules: {
        prs: { ignoredRepos: [], includeReviewRequests: true, rowCap: 8, staleDays: 0 },
        vulns: { ignoredRepos: [] },
        stars: old.modules.stars,
      },
    }),
    3: (old: ConfigV2): Config => ({
      pat: old.pat,
      pollMinutes: old.pollMinutes,
      themePin: old.themePin,
      repos: {
        ...CONFIG_DEFAULTS.repos,
        ignored: [...new Set([...old.modules.prs.ignoredRepos, ...old.modules.vulns.ignoredRepos])],
      },
      modules: {
        ...CONFIG_DEFAULTS.modules,
        prs: {
          enabled: true,
          rowCap: old.modules.prs.rowCap,
          includeReviewRequests: old.modules.prs.includeReviewRequests,
          staleDays: old.modules.prs.staleDays,
        },
        stars: { enabled: true, trackedRepos: old.modules.stars.trackedRepos },
      },
    }),
  },
});

export const SYNC_FALLBACK: SyncState = {
  lastSyncAt: 0,
  inFlightSince: 0,
  backoffUntil: 0,
  authError: false,
  login: '',
  lastError: null,
};

interface SyncV1 {
  lastSyncAt: number; inFlightSince: number; backoffUntil: number; pollIntervalHint: number; authError: boolean;
}

export const syncItem = storage.defineItem<SyncState>('local:sync', {
  version: 2,
  fallback: SYNC_FALLBACK,
  migrations: {
    2: ({ pollIntervalHint: _drop, ...old }: SyncV1): SyncState => ({ ...old, login: '', lastError: null }),
  },
});

export const modulesItem = storage.defineItem<ModulesState>('local:modules', {
  version: 1,
  fallback: {},
});

export const REPOS_FALLBACK: ReposCache = { scopeKey: '', discoveredAt: 0, refs: [] };

export const reposItem = storage.defineItem<ReposCache>('local:repos', {
  version: 1,
  fallback: REPOS_FALLBACK,
});

export async function resetAccount(pat: string): Promise<void> {
  const config = await configItem.getValue();
  await configItem.setValue({ ...config, pat: '' });
  await Promise.all([modulesItem.removeValue(), reposItem.removeValue(), syncItem.removeValue()]);
  await configItem.setValue({ ...config, pat });
}

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
