import { describe, it, expect } from 'vitest';
import { relTime, fmtCount } from './format';

const NOW = 1_800_000_000_000;

describe('relTime', () => {
  it('says just now under a minute', () => expect(relTime(NOW - 30_000, NOW)).toBe('just now'));
  it('minutes', () => expect(relTime(NOW - 2 * 60_000, NOW)).toBe('2m ago'));
  it('hours', () => expect(relTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago'));
  it('days', () => expect(relTime(NOW - 2 * 86_400_000, NOW)).toBe('2d ago'));
  it('never for zero', () => expect(relTime(0, NOW)).toBe('never'));
});

describe('fmtCount', () => {
  it('groups thousands', () => expect(fmtCount(1204)).toBe('1,204'));
  it('passes small numbers', () => expect(fmtCount(87)).toBe('87'));
});
