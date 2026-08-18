import * as github from './github';
import { GhAuthError, GhRateLimitError } from './github';
import { configItem, syncItem, modulesItem, migrateModules } from './storage';
import { MODULES } from './registry';
import { BASE_REPO_FIELDS, ensureRepos, fetchRepoNodes } from './scope';
import type { Config, ModuleDef, ModuleId, ModulesState, RepoNode, SyncState } from './types';

const LOCK_TTL = 120_000;
export const AUTH_BACKOFF_MS = 15 * 60_000;
export const ERROR_BACKOFF_MS = 60_000;

export type CycleStatus = 'ok' | 'no-token' | 'backoff' | 'in-flight' | 'auth-error' | 'error' | 'stale';

function isEnabled(config: Config, m: ModuleDef): boolean {
  const cfg = config.modules[m.id as ModuleId] as { enabled?: boolean } | undefined;
  return cfg?.enabled !== false;
}

function rootQuery(config: Config, mods: ModuleDef[]): string {
  const body = mods
    .filter((m) => m.graphql)
    .map((m) => m.graphql!.fragment(config, null))
    .filter(Boolean)
    .join('\n');
  return `query { viewer { login }\n${body} }`;
}

function pageQuery(config: Config, m: ModuleDef, cursor: string): string {
  return `query { ${m.graphql!.fragment(config, cursor)} }`;
}

async function cycle(now: number): Promise<CycleStatus> {
  let config: Config;
  try {
    config = await configItem.getValue();
    if (!config.pat) return 'no-token';
    const sync = await syncItem.getValue();
    if (sync.inFlightSince && now - sync.inFlightSince < LOCK_TTL) return 'in-flight';
    if (sync.backoffUntil > now) {
      if (sync.inFlightSince) await syncItem.setValue({ ...sync, inFlightSince: 0 });
      return 'backoff';
    }
    await syncItem.setValue({ ...sync, inFlightSince: now });
  } catch {
    return 'error';
  }

  try {
    const mods = MODULES.filter((m) => isEnabled(config, m));
    const stored = migrateModules(await modulesItem.getValue(), mods);
    const acc: Record<string, unknown> = {};

    const resp = await github.graphql<{ viewer: { login: string } }>(config.pat, rootQuery(config, mods));
    const login = resp.viewer.login;
    for (const m of mods) {
      if (m.graphql) acc[m.id] = m.graphql.map(resp, undefined, config);
    }
    for (const m of mods) {
      if (!m.graphql) continue;
      let cursor = (acc[m.id] as { nextCursor?: string | null } | undefined)?.nextCursor;
      while (cursor) {
        const page = await github.graphql<unknown>(config.pat, pageQuery(config, m, cursor));
        acc[m.id] = m.graphql.map(page, acc[m.id] as never, config);
        cursor = (acc[m.id] as { nextCursor?: string | null }).nextCursor;
      }
    }

    if (mods.some((m) => m.repoFields || m.mapRepos)) {
      const refs = await ensureRepos(config.pat, config.repos, now);
      const fields = [BASE_REPO_FIELDS, ...mods.flatMap((m) => (m.repoFields ? [m.repoFields(config)] : []))].join('\n');
      const nodes: RepoNode[] = mods.some((m) => m.repoFields)
        ? await fetchRepoNodes(config.pat, refs, fields)
        : refs.map((r) => ({ ...r }));
      for (const m of mods) {
        if (m.mapRepos) acc[m.id] = m.mapRepos(nodes, acc[m.id] as never, { config, login });
      }
    }

    for (const m of mods) {
      if (m.fetchData) acc[m.id] = await m.fetchData({ pat: config.pat, config }, stored[m.id]?.data as never, now);
    }

    const next: ModulesState = {};
    for (const m of mods) {
      const r = m.derive(acc[m.id] as never, stored[m.id]?.data as never, now, config);
      next[m.id] = { v: m.version, slice: r.slice, data: r.stored };
    }

    if ((await configItem.getValue()).pat !== config.pat) {
      await syncItem.setValue({ ...(await syncItem.getValue()), inFlightSince: 0 });
      return 'stale';
    }
    await modulesItem.setValue(next);
    await syncItem.setValue({
      ...(await syncItem.getValue()),
      lastSyncAt: now,
      inFlightSince: 0,
      backoffUntil: 0,
      authError: false,
      login,
      lastError: null,
    });
    return 'ok';
  } catch (e) {
    const s = await syncItem.getValue();
    const patch: SyncState = { ...s, inFlightSince: 0 };
    if (e instanceof GhRateLimitError) {
      await syncItem.setValue({ ...patch, backoffUntil: e.resetAt, lastError: 'rate-limit' });
      return 'error';
    }
    if (e instanceof GhAuthError) {
      await syncItem.setValue({ ...patch, authError: true, backoffUntil: now + AUTH_BACKOFF_MS, lastError: 'auth' });
      return 'auth-error';
    }
    await syncItem.setValue({ ...patch, backoffUntil: now + ERROR_BACKOFF_MS, lastError: 'error' });
    return 'error';
  }
}

let inFlight: Promise<CycleStatus> | null = null;

export async function runCycle(now: number = Date.now()): Promise<CycleStatus> {
  if (inFlight) return 'in-flight';
  inFlight = cycle(now);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
