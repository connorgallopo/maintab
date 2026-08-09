export function relTime(thenMs: number, nowMs: number): string {
  if (!thenMs) return 'never';
  const s = Math.floor((nowMs - thenMs) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}
