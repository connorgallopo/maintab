import type { Config, FetchCtx, ModuleDef, Slice } from '../lib/types';
import * as github from '../lib/github';
import { configItem, modulesItem } from '../lib/storage';

export interface Thread {
  id: string;
  repo: string;
  title: string;
  reason: string;
  href: string;
}

export interface NotifStored {
  lastModified: string | null;
  fetchedAt: number;
  pollInterval: number;
  threads: Thread[];
}

export interface NotifData {
  threads: Thread[];
  changed: boolean;
  lastModified?: string | null;
  pollInterval?: number;
}

interface ApiThread {
  id: string;
  reason: string;
  repository: { full_name: string; html_url: string };
  subject: { title: string; type: string; url: string | null };
}

export function subjectWebUrl(subject: { type: string; url: string | null }, repoUrl: string): string {
  if (!subject.url) return repoUrl;
  const web = subject.url
    .replace('https://api.github.com/repos/', 'https://github.com/')
    .replace('/pulls/', '/pull/');
  return web.startsWith('https://github.com/') ? web : repoUrl;
}

async function fetchData(ctx: FetchCtx, stored: NotifStored | undefined, now: number): Promise<NotifData> {
  const interval = (stored?.pollInterval ?? 60) * 1000;
  if (stored && now - stored.fetchedAt < interval) {
    return { threads: stored.threads, changed: false };
  }
  const res = await github.restGet(ctx.pat, '/notifications', {
    ifModifiedSince: stored?.lastModified ?? undefined,
  });
  if (res.status === 304) {
    return { threads: stored?.threads ?? [], changed: false };
  }
  const threads = (res.json as ApiThread[]).map((t) => ({
    id: t.id,
    repo: t.repository.full_name,
    title: t.subject.title,
    reason: t.reason.replace(/_/g, ' '),
    href: subjectWebUrl(t.subject, t.repository.html_url),
  }));
  return { threads, changed: true, lastModified: res.lastModified, pollInterval: res.pollInterval ?? 60 };
}

function derive(data: NotifData, stored: NotifStored | undefined, now: number, _config?: Config): { slice: Slice; stored: NotifStored } {
  const reviews = data.threads.filter((t) => t.reason === 'review requested').length;
  const nextStored: NotifStored = {
    lastModified: data.changed ? (data.lastModified ?? null) : (stored?.lastModified ?? null),
    fetchedAt: data.changed ? now : (stored?.fetchedAt ?? 0),
    pollInterval: data.pollInterval ?? stored?.pollInterval ?? 60,
    threads: data.threads,
  };
  return {
    slice: {
      status: data.threads.length ? 'ok' : 'empty',
      emptyText: 'Inbox zero',
      headerHref: 'https://github.com/notifications',
      headerLabel: `Notifications (${data.threads.length})`,
      items: data.threads.map((t) => ({
        id: t.id,
        href: t.href,
        repo: t.repo.split('/')[1],
        primary: t.title,
        badge: { kind: 'tag' as const, text: t.reason, tone: 'dim' as const },
      })),
      tile: {
        n: data.threads.length,
        label: 'Notifications',
        note: reviews ? `${reviews} review request${reviews === 1 ? '' : 's'}` : undefined,
        noteTone: reviews ? 'good' : undefined,
      },
    },
    stored: nextStored,
  };
}

export const notificationsModule: ModuleDef<NotifData, NotifStored> = {
  id: 'notifications',
  title: 'Notifications',
  version: 1,
  fetchData,
  derive,
};

export async function markRead(threadId: string): Promise<void> {
  const config = await configItem.getValue();
  if (!config.pat) return;
  await github.restPatch(config.pat, `/notifications/threads/${threadId}`);
  const state = await modulesItem.getValue();
  const entry = state.notifications;
  if (!entry) return;
  const stored = entry.data as NotifStored;
  const threads = stored.threads.filter((t) => t.id !== threadId);
  const { slice, stored: nextStored } = derive({ threads, changed: false }, stored, Date.now());
  await modulesItem.setValue({ ...state, notifications: { ...entry, slice, data: nextStored } });
}
