import type { Config, ModuleDef, RepoCtx, RepoNode, RowItem, Slice } from '../lib/types';
import { CONFIG_DEFAULTS } from '../lib/storage';
import { applySeen, pillFor, type SeenStore } from '../lib/seen';
import { PR_NODE_FIELDS, mapPrNode, prStatusTag, type PrBase, type PrNode } from '../lib/pr';

const DAY = 86_400_000;

export interface MyPr extends PrBase {
  repo: string;
  reviewRequested: boolean;
}

export interface PrsData {
  prs: MyPr[];
  login: string;
  maintained: string[];
}

export type PrsStored = SeenStore;

type SearchNode = PrNode & { repository: { nameWithOwner: string } };

const NODE = `... on PullRequest { ${PR_NODE_FIELDS} repository { nameWithOwner } }`;

function fragment(config: Config, _cursor: string | null): string {
  const inv = `prsInv: search(type: ISSUE, first: 50, query: "is:pr is:open involves:@me sort:updated-desc") {
  issueCount
  nodes { ${NODE} }
}`;
  if (!config.modules.prs.includeReviewRequests) return inv;
  return `${inv}
prsRev: search(type: ISSUE, first: 25, query: "is:pr is:open review-requested:@me -reviewed-by:@me sort:updated-desc") {
  issueCount
  nodes { ${NODE} }
}`;
}

interface SearchResp {
  prsInv: { issueCount: number; nodes: SearchNode[] };
  prsRev?: { issueCount: number; nodes: SearchNode[] };
}

function map(resp: unknown, _prev: PrsData | undefined, _config?: Config): PrsData {
  const r = resp as SearchResp;
  const revNodes = r.prsRev?.nodes ?? [];
  const revIds = new Set(revNodes.map((n) => n.id));
  const byId = new Map<string, MyPr>();
  for (const n of [...r.prsInv.nodes, ...revNodes]) {
    if (byId.has(n.id)) continue;
    byId.set(n.id, { ...mapPrNode(n), repo: n.repository.nameWithOwner, reviewRequested: revIds.has(n.id) });
  }
  return { prs: [...byId.values()], login: '', maintained: [] };
}

function mapRepos(repos: RepoNode[], prev: PrsData | undefined, ctx: RepoCtx): PrsData {
  return { prs: prev?.prs ?? [], login: ctx.login, maintained: repos.map((r) => r.nameWithOwner) };
}

function derive(data: PrsData, stored: PrsStored | undefined, now: number, config?: Config): { slice: Slice; stored: PrsStored } {
  const cfg = config?.modules.prs ?? CONFIG_DEFAULTS.modules.prs;
  const maintained = new Set(data.maintained);

  const kept = data.prs
    .map((pr) => ({ pr, authored: data.login !== '' && pr.author === data.login }))
    .filter(({ pr, authored }) => authored || pr.reviewRequested || !maintained.has(pr.repo))
    .filter(({ pr }) => cfg.staleDays <= 0 || now - pr.updatedAt <= cfg.staleDays * DAY)
    .sort((a, b) => b.pr.updatedAt - a.pr.updatedAt);

  const { marks, next } = applySeen(
    stored,
    kept.map(({ pr, authored }) => ({ id: pr.id, total: pr.total, createdAt: pr.createdAt, flagNew: !authored })),
    now,
  );

  const items: RowItem[] = kept.map(({ pr, authored }) => ({
    id: pr.id,
    href: pr.url,
    repo: `${pr.repo.split('/')[1] ?? pr.repo} #${pr.number}`,
    primary: pr.title,
    tag: prStatusTag(pr, { reviewRequested: pr.reviewRequested, authored }),
    pill: pillFor(marks[pr.id]),
    mark: { total: pr.total },
  }));

  const cap = Math.max(1, cfg.rowCap);
  const rows = items.slice(0, cap);
  const reviewReq = kept.filter(({ pr }) => pr.reviewRequested).length;
  const active = items.filter((i) => i.pill).length;
  const headerLabel = rows.length < items.length
    ? `My PRs (showing ${rows.length} of ${items.length})`
    : `My PRs (${items.length})`;

  return {
    slice: {
      status: rows.length ? 'ok' : 'empty',
      emptyText: 'No open PRs',
      headerHref: 'https://github.com/pulls',
      headerLabel,
      items: rows,
      tile: {
        n: items.length,
        label: 'My PRs',
        note: reviewReq ? `${reviewReq} awaiting my review` : active ? `${active} with new activity` : undefined,
        noteTone: reviewReq ? 'accent' : active ? 'good' : undefined,
      },
    },
    stored: next,
  };
}

interface LegacyStored {
  seen?: Record<string, { commentTotal: number; seenAt: number }>;
}

export const prsModule: ModuleDef<PrsData, PrsStored> = {
  id: 'prs',
  title: 'My PRs',
  version: 2,
  migrate: (old) => {
    const legacy = (old as LegacyStored | undefined)?.seen ?? {};
    const seen: SeenStore['seen'] = {};
    for (const [id, s] of Object.entries(legacy)) seen[id] = { total: s.commentTotal, seenAt: s.seenAt };
    return { baselineAt: Date.now(), seen };
  },
  graphql: { fragment, map },
  mapRepos,
  derive,
};
