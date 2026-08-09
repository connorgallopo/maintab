import { describe, it, expect } from 'vitest';
import { starsModule } from './stars';
import type { Config } from '../lib/types';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const config = { modules: { stars: { trackedRepos: ['cgallopo/widgetlib', 'cgallopo/parsekit'] } } } as Config;

describe('fragment', () => {
  it('aliases one repository field per tracked repo', () => {
    const f = starsModule.graphql!.fragment(config, null);
    expect(f).toContain('s0: repository(owner: "cgallopo", name: "widgetlib")');
    expect(f).toContain('s1: repository(owner: "cgallopo", name: "parsekit")');
    expect(f).toContain('stargazerCount');
  });
});

describe('map', () => {
  it('reads aliased counts back into repo names', () => {
    const data = starsModule.graphql!.map(
      { s0: { stargazerCount: 1204 }, s1: { stargazerCount: 310 } },
      undefined, config,
    );
    expect(data).toEqual({ 'cgallopo/widgetlib': 1204, 'cgallopo/parsekit': 310 });
  });
});

describe('derive', () => {
  it('appends a history point for a new hour', () => {
    const stored = { history: { 'cgallopo/widgetlib': [{ t: NOW - 2 * HOUR, c: 1200 }] } };
    const { stored: next } = starsModule.derive({ 'cgallopo/widgetlib': 1204 }, stored, NOW);
    expect(next.history['cgallopo/widgetlib']).toHaveLength(2);
  });

  it('skips points within the same hour', () => {
    const stored = { history: { 'cgallopo/widgetlib': [{ t: NOW - HOUR / 2, c: 1204 }] } };
    const { stored: next } = starsModule.derive({ 'cgallopo/widgetlib': 1205 }, stored, NOW);
    expect(next.history['cgallopo/widgetlib']).toHaveLength(1);
  });

  it('prunes points older than 90 days and dropped repos', () => {
    const stored = { history: {
      'cgallopo/widgetlib': [{ t: NOW - 91 * DAY, c: 900 }, { t: NOW - HOUR * 2, c: 1204 }],
      'cgallopo/gone': [{ t: NOW - HOUR, c: 5 }],
    } };
    const { stored: next } = starsModule.derive({ 'cgallopo/widgetlib': 1204 }, stored, NOW);
    expect(next.history['cgallopo/widgetlib'].every((p) => p.t >= NOW - 90 * DAY)).toBe(true);
    expect(next.history['cgallopo/gone']).toBeUndefined();
  });

  it('computes a weekly delta and sparkline from history', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ t: NOW - (7 - i) * DAY, c: 1166 + i * 5 }));
    const { slice } = starsModule.derive(
      { 'cgallopo/widgetlib': 1204 },
      { history: { 'cgallopo/widgetlib': history } },
      NOW,
    );
    expect(slice.items[0].value).toBe('1,204');
    expect(slice.items[0].delta).toBe('+38');
    expect(slice.items[0].spark!.length).toBeGreaterThan(2);
    expect(slice.items[0].href).toBe('https://github.com/cgallopo/widgetlib');
  });

  it('empty state with no tracked repos', () => {
    const { slice } = starsModule.derive({}, undefined, NOW);
    expect(slice.status).toBe('empty');
    expect(slice.emptyText).toBe('Pick repos to track in settings');
  });
});
