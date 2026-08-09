import { describe, it, expect, vi, afterEach } from 'vitest';
import { graphql, restGet, GhAuthError, GhRateLimitError } from './github';

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify(body), { status, headers },
  )));
}

afterEach(() => vi.unstubAllGlobals());

describe('graphql', () => {
  it('returns data and sends the token', async () => {
    mockFetch(200, { data: { viewer: { login: 'x' } } });
    const data = await graphql<{ viewer: { login: string } }>('tok', '{viewer{login}}');
    expect(data.viewer.login).toBe('x');
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.github.com/graphql');
    expect(call[1].headers.authorization).toBe('Bearer tok');
  });

  it('throws GhAuthError on 401', async () => {
    mockFetch(401, { message: 'Bad credentials' });
    await expect(graphql('bad', '{}')).rejects.toBeInstanceOf(GhAuthError);
  });

  it('throws GhRateLimitError with resetAt from headers on 403', async () => {
    mockFetch(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' });
    const err = await graphql('tok', '{}').catch((e) => e);
    expect(err).toBeInstanceOf(GhRateLimitError);
    expect(err.resetAt).toBe(1800000000_000);
  });

  it('throws on graphql-level errors', async () => {
    mockFetch(200, { errors: [{ message: 'boom' }] });
    await expect(graphql('tok', '{}')).rejects.toThrow('boom');
  });
});

describe('restGet', () => {
  it('passes If-Modified-Since and reads poll headers', async () => {
    mockFetch(200, [{ id: '1' }], {
      'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT',
      'x-poll-interval': '60',
    });
    const res = await restGet('tok', '/notifications', { ifModifiedSince: 'earlier' });
    expect(res.status).toBe(200);
    expect(res.lastModified).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
    expect(res.pollInterval).toBe(60);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers['if-modified-since']).toBe('earlier');
  });

  it('returns 304 without parsing a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 304 })));
    const res = await restGet('tok', '/notifications', { ifModifiedSince: 'x' });
    expect(res.status).toBe(304);
    expect(res.json).toBeNull();
  });
});
