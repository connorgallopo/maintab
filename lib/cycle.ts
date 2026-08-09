import * as github from './github';
import { GhAuthError, GhRateLimitError } from './github';
import { configItem, syncItem, modulesItem, migrateModules } from './storage';
import { MODULES } from './registry';
import type { Config, ModulesState } from './types';

const LOCK_TTL = 120_000;

function buildQuery(config: Config, only?: { fragment: (c: Config, cur: string | null) => string; cursor: string | null }): string {
  const body = only
    ? only.fragment(config, only.cursor)
    : MODULES.filter((m) => m.graphql)
        .map((m) => m.graphql!.fragment(config, null))
        .filter(Boolean)
        .join('\n');
  return `query { ${body} }`;
}

export type CycleStatus = 'ok' | 'no-token' | 'backoff' | 'in-flight' | 'auth-error' | 'error';

async function cycle(now: number): Promise<CycleStatus> {
  const config = await configItem.getValue();
  if (!config.pat) return 'no-token';
  const sync = await syncItem.getValue();
  if (sync.backoffUntil > now) return 'backoff';
  if (sync.inFlightSince && now - sync.inFlightSince < LOCK_TTL) return 'in-flight';
  await syncItem.setValue({ ...sync, inFlightSince: now });

  try {
    const stored = migrateModules(await modulesItem.getValue(), MODULES);
    const acc: Record<string, unknown> = {};

    const resp = await github.graphql<unknown>(config.pat, buildQuery(config));
    for (const m of MODULES) {
      if (m.graphql) acc[m.id] = m.graphql.map(resp, undefined, config);
    }
    for (const m of MODULES) {
      if (!m.graphql) continue;
      let cursor = (acc[m.id] as { nextCursor?: string | null } | undefined)?.nextCursor;
      while (cursor) {
        const page = await github.graphql<unknown>(
          config.pat,
          buildQuery(config, { fragment: m.graphql.fragment, cursor }),
        );
        acc[m.id] = m.graphql.map(page, acc[m.id] as never, config);
        cursor = (acc[m.id] as { nextCursor?: string | null }).nextCursor;
      }
    }
    for (const m of MODULES) {
      if (m.fetchData) acc[m.id] = await m.fetchData({ pat: config.pat, config }, stored[m.id]?.data as never, now);
    }

    const next: ModulesState = {};
    for (const m of MODULES) {
      const r = m.derive(acc[m.id] as never, stored[m.id]?.data as never, now);
      next[m.id] = { v: m.version, slice: r.slice, data: r.stored };
    }
    await modulesItem.setValue(next);
    await syncItem.setValue({
      ...(await syncItem.getValue()),
      lastSyncAt: now,
      inFlightSince: 0,
      authError: false,
    });
    return 'ok';
  } catch (e) {
    const s = await syncItem.getValue();
    const patch = { ...s, inFlightSince: 0 };
    if (e instanceof GhRateLimitError) {
      await syncItem.setValue({ ...patch, backoffUntil: e.resetAt });
      return 'error';
    }
    if (e instanceof GhAuthError) {
      await syncItem.setValue({ ...patch, authError: true });
      return 'auth-error';
    }
    await syncItem.setValue(patch);
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
