const API = 'https://api.github.com';

export class GhAuthError extends Error {}

export class GhRateLimitError extends Error {
  constructor(public resetAt: number) {
    super('rate limited');
  }
}

export interface RestResult {
  status: number;
  json: unknown;
  lastModified: string | null;
  pollInterval: number | null;
}

function throwForStatus(res: Response): void {
  if (res.status === 401) throw new GhAuthError('token rejected');
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    throw new GhRateLimitError(reset ? Number(reset) * 1000 : Date.now() + 60_000);
  }
}

export async function graphql<T>(pat: string, query: string): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pat}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  throwForStatus(res);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!body.data) throw new Error('empty graphql response');
  return body.data;
}

export async function restGet(
  pat: string,
  path: string,
  opts: { ifModifiedSince?: string } = {},
): Promise<RestResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${pat}`,
    accept: 'application/vnd.github+json',
  };
  if (opts.ifModifiedSince) headers['if-modified-since'] = opts.ifModifiedSince;
  const res = await fetch(`${API}${path}`, { headers });
  throwForStatus(res);
  const poll = res.headers.get('x-poll-interval');
  return {
    status: res.status,
    json: res.status === 304 ? null : await res.json(),
    lastModified: res.headers.get('last-modified'),
    pollInterval: poll ? Number(poll) : null,
  };
}
