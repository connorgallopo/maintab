import type { Config, ModuleDef, Slice } from '../lib/types';
import { fmtCount } from '../lib/format';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const KEEP = 90 * DAY;

export type StarsData = Record<string, number>;

export interface StarsStored {
  history: Record<string, { t: number; c: number }[]>;
}

function fragment(config: Config, _cursor: string | null): string {
  return config.modules.stars.trackedRepos
    .map((full, i) => {
      const [owner, name] = full.split('/');
      return `s${i}: repository(owner: "${owner}", name: "${name}") { stargazerCount }`;
    })
    .join('\n');
}

function map(resp: unknown, _prev: StarsData | undefined, config?: Config): StarsData {
  if (!config) return {};
  const out: StarsData = {};
  config.modules.stars.trackedRepos.forEach((full, i) => {
    const node = (resp as Record<string, { stargazerCount: number } | null>)[`s${i}`];
    if (node) out[full] = node.stargazerCount;
  });
  return out;
}

function derive(data: StarsData, stored: StarsStored | undefined, now: number, _config?: Config): { slice: Slice; stored: StarsStored } {
  const history: StarsStored['history'] = {};
  const items = Object.entries(data).map(([repo, count]) => {
    const prev = stored?.history[repo] ?? [];
    const fresh = prev.filter((p) => p.t >= now - KEEP);
    const last = fresh[fresh.length - 1];
    if (!last || now - last.t >= HOUR) fresh.push({ t: now, c: count });
    history[repo] = fresh;
    const weekAgo = now - 7 * DAY;
    const base = fresh.find((p) => p.t >= weekAgo) ?? fresh[0];
    const delta = count - (base?.c ?? count);
    return {
      id: repo,
      href: `https://github.com/${repo}`,
      repo,
      primary: '',
      spark: fresh.map((p) => p.c),
      value: fmtCount(count),
      delta: delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : undefined,
    };
  });
  return {
    slice: {
      status: items.length ? 'ok' : 'empty',
      emptyText: 'Pick repos to track in settings',
      headerHref: 'settings:stars',
      headerLabel: 'Stars',
      items,
      tile: undefined,
    },
    stored: { history },
  };
}

export const starsModule: ModuleDef<StarsData, StarsStored> = {
  id: 'stars',
  title: 'Stars',
  version: 1,
  graphql: { fragment, map },
  derive,
};
