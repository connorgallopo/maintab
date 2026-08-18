import { describe, it, expect } from 'vitest';
import { PR_NODE_FIELDS, mapPrNode, prStatusTag } from './pr';
import type { PrNode, PrStatus } from './pr';

const node = (o: Partial<PrNode> = {}): PrNode => ({
  id: 'PR_1', number: 7, title: 'Fix', url: 'https://github.com/a/b/pull/7',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  isDraft: false, reviewDecision: null, author: { login: 'octocat' },
  comments: { totalCount: 2 }, reviews: { totalCount: 1 },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...o,
});

const status = (o: Partial<PrStatus> = {}): PrStatus => ({ isDraft: false, reviewDecision: null, ci: null, ...o });

describe('PR_NODE_FIELDS', () => {
  it('requests the fields the cards need', () => {
    for (const f of ['id', 'number', 'title', 'url', 'createdAt', 'updatedAt', 'isDraft', 'reviewDecision', 'author { login }', 'comments { totalCount }', 'reviews { totalCount }', 'commits(last: 1)', 'statusCheckRollup { state }']) {
      expect(PR_NODE_FIELDS).toContain(f);
    }
  });
});

describe('mapPrNode', () => {
  it('parses dates, sums comments and reviews, reads the head CI state and author', () => {
    expect(mapPrNode(node())).toEqual({
      id: 'PR_1', number: 7, title: 'Fix', url: 'https://github.com/a/b/pull/7',
      createdAt: Date.parse('2026-01-01T00:00:00Z'), updatedAt: Date.parse('2026-01-02T00:00:00Z'),
      total: 3, author: 'octocat', isDraft: false, reviewDecision: null, ci: 'SUCCESS',
    });
  });

  it('tolerates a deleted author, no commits and no rollup', () => {
    const m = mapPrNode(node({ author: null, commits: { nodes: [] } }));
    expect(m.author).toBe('');
    expect(m.ci).toBeNull();
    expect(mapPrNode(node({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).ci).toBeNull();
  });
});

describe('prStatusTag', () => {
  it('review request wins over everything', () => {
    expect(prStatusTag(status({ isDraft: true, ci: 'FAILURE' }), { reviewRequested: true })).toEqual({ text: 'review', tone: 'accent' });
  });

  it('follows the priority draft > ci failing > changes requested > approved > needs review', () => {
    expect(prStatusTag(status({ isDraft: true, ci: 'FAILURE' }))).toEqual({ text: 'draft', tone: 'dim' });
    expect(prStatusTag(status({ ci: 'ERROR', reviewDecision: 'APPROVED' }))).toEqual({ text: 'ci failing', tone: 'crit' });
    expect(prStatusTag(status({ ci: 'FAILURE' }))).toEqual({ text: 'ci failing', tone: 'crit' });
    expect(prStatusTag(status({ reviewDecision: 'CHANGES_REQUESTED', ci: 'SUCCESS' }))).toEqual({ text: 'changes requested', tone: 'warn' });
    expect(prStatusTag(status({ reviewDecision: 'APPROVED' }))).toEqual({ text: 'approved', tone: 'good' });
    expect(prStatusTag(status({ reviewDecision: 'REVIEW_REQUIRED' }))).toEqual({ text: 'needs review', tone: 'accent' });
  });

  it('tags non-authored rows as involved only when the caller says the row is not authored', () => {
    expect(prStatusTag(status(), { authored: false })).toEqual({ text: 'involved', tone: 'dim' });
    expect(prStatusTag(status(), { authored: true })).toBeUndefined();
    expect(prStatusTag(status())).toBeUndefined();
  });

  it('pending or successful CI adds nothing', () => {
    expect(prStatusTag(status({ ci: 'PENDING' }))).toBeUndefined();
    expect(prStatusTag(status({ ci: 'SUCCESS' }))).toBeUndefined();
  });
});
