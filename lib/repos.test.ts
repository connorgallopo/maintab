import { describe, it, expect } from 'vitest';
import { parseRepo } from './repos';

describe('parseRepo', () => {
  it('accepts owner/name', () => expect(parseRepo('cgallopo/widgetlib')).toBe('cgallopo/widgetlib'));
  it('trims whitespace', () => expect(parseRepo('  cgallopo/widgetlib  ')).toBe('cgallopo/widgetlib'));
  it('accepts a github url', () => expect(parseRepo('https://github.com/cgallopo/widgetlib')).toBe('cgallopo/widgetlib'));
  it('strips trailing slashes and .git', () => expect(parseRepo('https://github.com/cgallopo/widgetlib.git')).toBe('cgallopo/widgetlib'));
  it('rejects garbage', () => expect(parseRepo('not a repo')).toBeNull());
  it('rejects empty', () => expect(parseRepo('')).toBeNull());
});
