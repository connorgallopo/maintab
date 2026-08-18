<script lang="ts">
  import type { Tile } from '../../lib/types';
  let { tile }: { tile: Tile } = $props();
</script>

<div class="stat">
  <div class="n" class:tone-accent={tile.tone === 'accent'} class:tone-crit={tile.tone === 'crit'}>{tile.n}</div>
  <div class="l">{tile.label}</div>
  {#if tile.note}<div class="d tone-{tile.noteTone ?? 'dim'}">{tile.note}</div>{/if}
</div>

<style>
  .stat { flex: 1; padding: 18px 22px 15px; }
  .n {
    font-size: 44px; font-weight: 700; line-height: 1;
    font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
  }
  .n.tone-accent { color: var(--accent); }
  .n.tone-crit { color: var(--crit); }
  .tone-accent { color: var(--accent); }
  .l {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.14em; color: var(--sub); margin-top: 8px;
  }
  .d { font-family: var(--font-mono); font-size: 11px; margin-top: 3px; }
  .tone-good { color: var(--good); }
  .tone-crit { color: var(--crit); }
  .tone-warn { color: var(--warn); }
  .tone-dim { color: var(--dim); }
</style>
