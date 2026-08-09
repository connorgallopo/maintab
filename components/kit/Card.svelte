<script lang="ts">
  import type { Slice } from '../../lib/types';
  import RowLine from './RowLine.svelte';
  let { slice, onheader, onrow, onrowact }: {
    slice: Slice;
    onheader?: (href: string) => boolean;
    onrow?: (id: string) => void;
    onrowact?: (id: string) => void;
  } = $props();

  function headerClick(e: MouseEvent) {
    if (onheader?.(slice.headerHref)) e.preventDefault();
  }
</script>

<section class="card">
  <header>
    <span>{slice.headerLabel}</span>
    <a class="more" href={slice.headerHref} onclick={headerClick}>&rarr;</a>
  </header>
  {#if slice.status === 'empty'}
    <p class="state">{slice.emptyText}</p>
  {:else if slice.status === 'error'}
    <p class="state">Couldn't load. Data may be stale.</p>
  {:else}
    {#each slice.items as item (item.id)}
      <RowLine {item} onclick={() => onrow?.(item.id)} onact={onrowact ? () => onrowact(item.id) : undefined} />
    {/each}
  {/if}
</section>

<style>
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 11px 20px; border-bottom: 1px solid var(--border);
    font-weight: 500; font-size: 13px;
  }
  .more { color: var(--accent); font-family: var(--font-mono); font-size: 12px; text-decoration: none; }
  .state { padding: 20px; color: var(--sub); font-size: 13px; }
</style>
