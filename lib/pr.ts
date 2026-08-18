import type { Tone } from './types';

export const PR_NODE_FIELDS = `id number title url createdAt updatedAt isDraft reviewDecision
author { login }
comments { totalCount }
reviews { totalCount }
commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface PrNode {
  id: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  author: { login: string } | null;
  comments: { totalCount: number };
  reviews: { totalCount: number };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

export interface PrStatus {
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  ci: string | null;
}

export interface PrBase extends PrStatus {
  id: string;
  number: number;
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  total: number;
  author: string;
}

export function mapPrNode(n: PrNode): PrBase {
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    createdAt: Date.parse(n.createdAt),
    updatedAt: Date.parse(n.updatedAt),
    total: n.comments.totalCount + n.reviews.totalCount,
    author: n.author?.login ?? '',
    isDraft: n.isDraft,
    reviewDecision: n.reviewDecision,
    ci: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

export interface PrTagFlags {
  reviewRequested?: boolean;
  authored?: boolean;
}

export function prStatusTag(s: PrStatus, flags: PrTagFlags = {}): { text: string; tone: Tone } | undefined {
  if (flags.reviewRequested) return { text: 'review', tone: 'accent' };
  if (s.isDraft) return { text: 'draft', tone: 'dim' };
  if (s.ci === 'FAILURE' || s.ci === 'ERROR') return { text: 'ci failing', tone: 'crit' };
  if (s.reviewDecision === 'CHANGES_REQUESTED') return { text: 'changes requested', tone: 'warn' };
  if (s.reviewDecision === 'APPROVED') return { text: 'approved', tone: 'good' };
  if (s.reviewDecision === 'REVIEW_REQUIRED') return { text: 'needs review', tone: 'accent' };
  if (flags.authored === false) return { text: 'involved', tone: 'dim' };
  return undefined;
}
