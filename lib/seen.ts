import { modulesItem } from './storage';

export interface SeenStore {
  baselineAt: number;
  seen: Record<string, { total: number; seenAt: number }>;
}

export interface SeenInput {
  id: string;
  total: number;
  createdAt: number;
  flagNew: boolean;
}

export interface SeenMark {
  unread: number;
  isNew: boolean;
}

export function applySeen(
  store: SeenStore | undefined,
  items: SeenInput[],
  now: number,
): { marks: Record<string, SeenMark>; next: SeenStore } {
  const baselineAt = store?.baselineAt ?? now;
  const seen: SeenStore['seen'] = {};
  const marks: Record<string, SeenMark> = {};
  for (const item of items) {
    const prev = store?.seen[item.id];
    if (prev) {
      const total = Math.min(prev.total, item.total);
      seen[item.id] = { total, seenAt: prev.seenAt };
      marks[item.id] = { unread: item.total - total, isNew: false };
    } else if (item.flagNew && item.createdAt > baselineAt) {
      marks[item.id] = { unread: 0, isNew: true };
    } else {
      seen[item.id] = { total: item.total, seenAt: now };
      marks[item.id] = { unread: 0, isNew: false };
    }
  }
  return { marks, next: { baselineAt, seen } };
}

export function pillFor(mark: SeenMark | undefined): { text: string } | undefined {
  if (!mark) return undefined;
  if (mark.isNew) return { text: 'new' };
  if (mark.unread > 0) return { text: `${mark.unread} new` };
  return undefined;
}

export async function markSeen(moduleId: string, rowId: string, now: number = Date.now()): Promise<void> {
  const state = await modulesItem.getValue();
  const entry = state[moduleId];
  if (!entry) return;
  const item = entry.slice.items.find((i) => i.id === rowId);
  if (!item?.mark) return;
  const data = entry.data as SeenStore;
  const seen = { ...data.seen, [rowId]: { total: item.mark.total, seenAt: now } };
  const items = entry.slice.items.map((i) => (i.id === rowId ? { ...i, pill: undefined } : i));
  await modulesItem.setValue({
    ...state,
    [moduleId]: { ...entry, data: { ...data, seen }, slice: { ...entry.slice, items } },
  });
}
