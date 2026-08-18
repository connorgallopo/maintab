import type { Config, ModuleDef, RowItem, Slice } from '../lib/types';
import { modulesItem, CONFIG_DEFAULTS } from '../lib/storage';

const DAY = 86_400_000;

export interface PrView {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  updatedAt: number;
  commentTotal: number;
}

export interface RevView {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  updatedAt: number;
}

export interface PrsData {
  prs: PrView[];
  reviews: RevView[];
  authTotal: number;
  revTotal: number;
}

export interface PrsStored {
  seen: Record<string, { commentTotal: number; seenAt: number }>;
}

const PR_SEARCH = 'https://github.com/pulls?q=is%3Aopen+is%3Apr+author%3A%40me';

const PR_FIELDS = `... on PullRequest {
  id number title url updatedAt
  repository { nameWithOwner }
  comments { totalCount }
  reviews { totalCount }
}`;

function fragment(config: Config, _cursor: string | null): string {
  const auth = `prsAuth: search(type: ISSUE, first: 50, query: "is:pr is:open author:@me sort:updated-desc") {
    issueCount
    nodes { ${PR_FIELDS} }
  }`;
  if (!config.modules.prs.includeReviewRequests) return auth;
  return `${auth}
prsRev: search(type: ISSUE, first: 25, query: "is:pr is:open review-requested:@me -reviewed-by:@me sort:updated-desc") {
  issueCount
  nodes { ${PR_FIELDS} }
}`;
}

interface PrNode {
  id: string; number: number; title: string; url: string; updatedAt: string;
  repository: { nameWithOwner: string };
  comments: { totalCount: number };
  reviews: { totalCount: number };
}

interface PrsResp {
  prsAuth: { issueCount: number; nodes: PrNode[] };
  prsRev?: { issueCount: number; nodes: PrNode[] };
}

function map(resp: unknown, _prev: PrsData | undefined, _config?: Config): PrsData {
  const r = resp as PrsResp;
  const prs: PrView[] = r.prsAuth.nodes.map((n) => ({
    id: n.id,
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    updatedAt: Date.parse(n.updatedAt),
    commentTotal: n.comments.totalCount + n.reviews.totalCount,
  }));
  const reviews: RevView[] = (r.prsRev?.nodes ?? []).map((n) => ({
    id: n.id,
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    updatedAt: Date.parse(n.updatedAt),
  }));
  return {
    prs,
    reviews,
    authTotal: r.prsAuth.issueCount,
    revTotal: r.prsRev?.issueCount ?? 0,
  };
}

function derive(data: PrsData, stored: PrsStored | undefined, now: number, config?: Config): { slice: Slice; stored: PrsStored } {
  const cfg = config?.modules.prs ?? CONFIG_DEFAULTS.modules.prs;
  const inScope = (_repo: string, updatedAt: number) =>
    cfg.staleDays <= 0 || now - updatedAt <= cfg.staleDays * DAY;

  const filteredAuthored = data.prs.filter((pr) => inScope(pr.repo, pr.updatedAt));
  const filteredReviews = data.reviews.filter((r) => inScope(r.repo, r.updatedAt));
  const authoredIds = new Set(filteredAuthored.map((pr) => pr.id));
  const dedupedReviews = filteredReviews.filter((r) => !authoredIds.has(r.id));

  const seen: PrsStored['seen'] = {};
  let touched = 0;
  const authoredItems: RowItem[] = filteredAuthored.map((pr) => {
    const marker = stored?.seen[pr.id]?.commentTotal ?? pr.commentTotal;
    const clamped = Math.min(marker, pr.commentTotal);
    seen[pr.id] = { commentTotal: clamped, seenAt: stored?.seen[pr.id]?.seenAt ?? now };
    const unread = pr.commentTotal - clamped;
    if (unread > 0) touched += 1;
    return {
      id: pr.id,
      href: pr.url,
      repo: `${pr.repo.split('/')[1]} #${pr.number}`,
      primary: pr.title,
      badge: unread > 0 ? { kind: 'pill' as const, text: `${unread} new`, tone: 'accent' as const } : undefined,
    };
  });

  const reviewItems: RowItem[] = dedupedReviews.map((r) => ({
    id: r.id,
    href: r.url,
    repo: `${r.repo.split('/')[1]} #${r.number}`,
    primary: r.title,
    badge: { kind: 'tag' as const, text: 'review', tone: 'accent' as const },
  }));

  const combined = [...authoredItems, ...reviewItems];
  const cap = Math.max(1, cfg.rowCap);
  const items = combined.slice(0, cap);
  const truncated = items.length < combined.length;

  const headerLabel = truncated
    ? `Open PRs (showing ${items.length} of ${combined.length})`
    : dedupedReviews.length
      ? `Open PRs (${filteredAuthored.length} + ${dedupedReviews.length} reviews)`
      : `Open PRs (${filteredAuthored.length})`;

  return {
    slice: {
      status: items.length ? 'ok' : 'empty',
      emptyText: 'No open PRs',
      headerHref: PR_SEARCH,
      headerLabel,
      items,
      tile: {
        n: data.authTotal,
        label: 'Open PRs',
        note: touched
          ? `${touched} with new comments`
          : dedupedReviews.length
            ? `${dedupedReviews.length} review requests`
            : undefined,
        noteTone: touched ? 'good' : dedupedReviews.length ? 'dim' : undefined,
      },
    },
    stored: { seen },
  };
}

export const prsModule: ModuleDef<PrsData, PrsStored> = {
  id: 'prs',
  title: 'Open PRs',
  version: 1,
  graphql: { fragment, map },
  derive,
};

export async function markSeen(prId: string): Promise<void> {
  const state = await modulesItem.getValue();
  const entry = state.prs;
  if (!entry) return;
  const data = entry.data as PrsStored;
  const item = entry.slice.items.find((i) => i.id === prId);
  if (!item) return;
  if (item.badge && item.badge.kind !== 'pill') return;
  const current = data.seen[prId];
  const unread = item.badge ? Number.parseInt(item.badge.text, 10) : 0;
  data.seen[prId] = { commentTotal: (current?.commentTotal ?? 0) + unread, seenAt: Date.now() };
  item.badge = undefined;
  await modulesItem.setValue({ ...state, prs: { ...entry, data, slice: { ...entry.slice } } });
}
