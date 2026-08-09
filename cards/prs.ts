import type { Config, ModuleDef, RowItem, Slice } from '../lib/types';
import { modulesItem } from '../lib/storage';

export interface PrView {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  commentTotal: number;
}

export interface PrsData {
  prs: PrView[];
  totalCount: number;
}

export interface PrsStored {
  seen: Record<string, { commentTotal: number; seenAt: number }>;
}

const PR_SEARCH = 'https://github.com/pulls?q=is%3Aopen+is%3Apr+author%3A%40me';

function fragment(_config: Config, _cursor: string | null): string {
  return `viewer {
    pullRequests(states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}, first: 100) {
      totalCount
      nodes {
        id number title url
        repository { nameWithOwner }
        comments { totalCount }
        reviews { totalCount }
      }
    }
  }`;
}

interface PrsResp {
  viewer: {
    pullRequests: {
      totalCount: number;
      nodes: {
        id: string; number: number; title: string; url: string;
        repository: { nameWithOwner: string };
        comments: { totalCount: number };
        reviews: { totalCount: number };
      }[];
    };
  };
}

function map(resp: unknown): PrsData {
  const conn = (resp as PrsResp).viewer.pullRequests;
  return {
    totalCount: conn.totalCount,
    prs: conn.nodes.map((n) => ({
      id: n.id,
      repo: n.repository.nameWithOwner,
      number: n.number,
      title: n.title,
      url: n.url,
      commentTotal: n.comments.totalCount + n.reviews.totalCount,
    })),
  };
}

function derive(data: PrsData, stored: PrsStored | undefined, now: number): { slice: Slice; stored: PrsStored } {
  const seen: PrsStored['seen'] = {};
  let touched = 0;
  const items: RowItem[] = data.prs.map((pr) => {
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
  const truncated = data.totalCount > data.prs.length;
  return {
    slice: {
      status: items.length ? 'ok' : 'empty',
      emptyText: 'No open PRs',
      headerHref: PR_SEARCH,
      headerLabel: truncated
        ? `Open PRs (showing ${data.prs.length} of ${data.totalCount})`
        : `Open PRs (${data.totalCount})`,
      items,
      tile: {
        n: data.totalCount,
        label: 'Open PRs',
        note: touched ? `${touched} with new comments` : undefined,
        noteTone: touched ? 'good' : undefined,
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
  const current = data.seen[prId];
  const unread = item.badge ? Number.parseInt(item.badge.text, 10) : 0;
  data.seen[prId] = { commentTotal: (current?.commentTotal ?? 0) + unread, seenAt: Date.now() };
  item.badge = undefined;
  await modulesItem.setValue({ ...state, prs: { ...entry, data, slice: { ...entry.slice } } });
}
