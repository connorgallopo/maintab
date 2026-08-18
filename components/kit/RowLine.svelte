<script lang="ts">
  import type { RowItem } from '../../lib/types';
  import Sparkline from './Sparkline.svelte';
  let { item, onclick, onact }: { item: RowItem; onclick?: () => void; onact?: () => void } = $props();
</script>

<a class="row" href={item.href} onclick={onclick}>
  <span class="main">
    {#if item.repo}<span class="repo">{item.repo}</span>{/if}
    {#if item.primary}<span class="primary">{item.primary}</span>{/if}
  </span>
  {#if item.spark}<Sparkline points={item.spark} />{/if}
  {#if item.value}<span class="value">{item.value}{#if item.delta}<span class="delta"> {item.delta}</span>{/if}</span>{/if}
  {#if item.tag}<span class="tag tone-{item.tag.tone}">{item.tag.text}</span>{/if}
  {#if item.pill}<span class="pill">{item.pill.text}</span>{/if}
  {#if item.counts}
    <span class="counts">
      {#each item.counts as c, i}{#if i}<span class="sep">/</span>{/if}<span class="cnt tone-{c.tone}">{c.value}</span>{/each}
    </span>
  {/if}
  {#if onact}
    <button class="act" aria-label="Mark as read" onclick={(e) => { e.preventDefault(); e.stopPropagation(); onact(); }}>&#10003;</button>
  {/if}
</a>

<style>
  .row {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 12px 20px; color: var(--ink); text-decoration: none; cursor: pointer;
  }
  .row:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .main { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .repo { font-family: var(--font-mono); font-size: 11px; color: var(--sub); white-space: nowrap; }
  .primary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .delta { font-size: 11px; color: var(--good); }
  .tag, .pill { font-family: var(--font-mono); font-size: 11px; white-space: nowrap; }
  .pill { background: var(--accent); color: var(--accent-ink); border-radius: 4px; padding: 2px 7px; font-weight: 500; }
  .tag.tone-crit { color: var(--crit); }
  .tag.tone-warn { color: var(--warn); }
  .tag.tone-good { color: var(--good); }
  .tag.tone-accent { color: var(--accent); }
  .tag.tone-dim, .tag.tone-mid { color: var(--sub); }
  .counts { display: flex; gap: 2px; font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
  .sep { color: var(--dim); }
  .cnt.tone-crit { color: var(--crit); }
  .cnt.tone-warn { color: var(--warn); }
  .cnt.tone-mid { color: var(--sub); }
  .cnt.tone-good { color: var(--good); }
  .cnt.tone-accent { color: var(--accent); }
  .cnt.tone-dim { color: var(--dim); }
  .act { opacity: 0; border: none; background: none; color: var(--accent); cursor: pointer; font-size: 12px; padding: 2px 4px; }
  .row:hover .act, .act:focus-visible { opacity: 1; }
</style>
