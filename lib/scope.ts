import * as github from './github';
import { reposItem } from './storage';
import type { RepoAffiliation, RepoNode, RepoPermission, RepoRef, RepoScopeConfig } from './types';

export const REPO_BATCH = 50;
export const REDISCOVER_MS = 6 * 3_600_000;
export const BASE_REPO_FIELDS = 'nameWithOwner url isPrivate viewerPermission';

const RANK: Record<RepoPermission, number> = { READ: 0, TRIAGE: 1, WRITE: 2, MAINTAIN: 3, ADMIN: 4 };
const AFFILIATION_ORDER: RepoAffiliation[] = ['OWNER', 'COLLABORATOR', 'ORGANIZATION_MEMBER'];

function affiliationList(scope: RepoScopeConfig): RepoAffiliation[] {
  return AFFILIATION_ORDER.filter((a) => scope.affiliations.includes(a));
}

export function scopeKey(scope: RepoScopeConfig): string {
  return JSON.stringify({
    affiliations: affiliationList(scope),
    minPermission: scope.minPermission,
    includeForks: scope.includeForks,
  });
}

export function discoveryQuery(scope: RepoScopeConfig, cursor: string | null): string {
  const affiliations = `[${affiliationList(scope).join(', ')}]`;
  const forks = scope.includeForks ? '' : ', isFork: false';
  const after = cursor ? `, after: "${cursor}"` : '';
  return `query { viewer { repositories(affiliations: ${affiliations}, ownerAffiliations: ${affiliations}, isArchived: false${forks}, first: 100, orderBy: {field: NAME, direction: ASC}${after}) {
  pageInfo { hasNextPage endCursor }
  nodes { nameWithOwner url isPrivate viewerPermission }
} } }`;
}

export function meetsPermission(perm: RepoPermission | null, min: RepoPermission): boolean {
  return perm !== null && RANK[perm] >= RANK[min];
}

interface DiscoveryResp {
  viewer: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: (RepoRef | null)[];
    };
  };
}

export async function discoverRepos(pat: string, scope: RepoScopeConfig): Promise<RepoRef[]> {
  if (affiliationList(scope).length === 0) return [];
  const out: RepoRef[] = [];
  let cursor: string | null = null;
  do {
    const resp: DiscoveryResp = await github.graphql<DiscoveryResp>(pat, discoveryQuery(scope, cursor));
    const conn = resp.viewer.repositories;
    for (const n of conn.nodes) {
      if (n && meetsPermission(n.viewerPermission, scope.minPermission)) out.push(n);
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

export function applyLists(refs: RepoRef[], scope: RepoScopeConfig): RepoRef[] {
  const kept = refs.filter((r) => !scope.ignored.includes(r.nameWithOwner));
  const have = new Set(kept.map((r) => r.nameWithOwner));
  for (const name of scope.pinned) {
    if (have.has(name)) continue;
    have.add(name);
    kept.push({ nameWithOwner: name, url: `https://github.com/${name}`, isPrivate: false, viewerPermission: null });
  }
  return kept;
}

export async function ensureRepos(pat: string, scope: RepoScopeConfig, now: number): Promise<RepoRef[]> {
  const cache = await reposItem.getValue();
  const key = scopeKey(scope);
  let refs = cache.refs;
  if (cache.scopeKey !== key || now - cache.discoveredAt > REDISCOVER_MS) {
    refs = await discoverRepos(pat, scope);
    await reposItem.setValue({ scopeKey: key, discoveredAt: now, refs });
  }
  return applyLists(refs, scope);
}

export async function invalidateRepos(): Promise<void> {
  const cache = await reposItem.getValue();
  await reposItem.setValue({ ...cache, scopeKey: '' });
}

export function batchQuery(refs: RepoRef[], fields: string): string {
  const aliases = refs
    .map((r, i) => {
      const [owner = '', name = ''] = r.nameWithOwner.split('/');
      return `r${i}: repository(owner: "${owner}", name: "${name}") { ...RepoFields }`;
    })
    .join('\n');
  return `query { ${aliases} }\nfragment RepoFields on Repository { ${fields} }`;
}

export async function fetchRepoNodes(pat: string, refs: RepoRef[], fields: string): Promise<RepoNode[]> {
  const out: RepoNode[] = [];
  for (let i = 0; i < refs.length; i += REPO_BATCH) {
    const chunk = refs.slice(i, i + REPO_BATCH);
    const resp = await github.graphql<Record<string, RepoNode | null>>(pat, batchQuery(chunk, fields));
    chunk.forEach((_, j) => {
      const node = resp[`r${j}`];
      if (node) out.push(node);
    });
  }
  return out;
}
