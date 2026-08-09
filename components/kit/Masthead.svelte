<script lang="ts">
  import { relTime } from '../../lib/format';
  let { lastSyncAt, busy, onrefresh }: { lastSyncAt: number; busy: boolean; onrefresh: () => void } = $props();

  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });
  const time = $derived(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const day = $derived(now.toLocaleDateString([], { weekday: 'long' }));
  const rest = $derived(now.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' }));
</script>

<div class="masthead">
  <div>
    <div class="clock">{time}</div>
    <div class="today"><b>{day}</b>&ensp;{rest}</div>
  </div>
  <button class="sync" onclick={onrefresh} disabled={busy} aria-label="Refresh now">
    {#if busy}<span class="spinner" aria-hidden="true"></span> syncing{:else}synced {relTime(lastSyncAt, now.getTime())}{/if}
  </button>
</div>

<style>
  .masthead { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 22px; }
  .clock {
    font-size: 34px; font-weight: 500; line-height: 1;
    font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
  }
  .today {
    font-family: var(--font-mono); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.14em; color: var(--sub); margin-top: 7px;
  }
  .today b { color: var(--ink); font-weight: 500; }
  .sync {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--dim); background: none; border: none;
    cursor: pointer; padding: 4px 0; display: flex; align-items: center; gap: 6px;
  }
  .sync:hover { color: var(--sub); }
  .spinner {
    width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid var(--dim); border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; opacity: 0.5; } }
</style>
