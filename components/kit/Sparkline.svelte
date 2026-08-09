<script lang="ts">
  let { points }: { points: number[] } = $props();
  const W = 72;
  const H = 20;
  const path = $derived.by(() => {
    if (points.length < 2) return '';
    const min = Math.min(...points);
    const span = Math.max(...points) - min || 1;
    return points
      .map((p, i) => `${(i / (points.length - 1)) * W},${H - 2 - ((p - min) / span) * (H - 4)}`)
      .join(' ');
  });
</script>

{#if path}
  <svg width={W} height={H} viewBox="0 0 {W} {H}" aria-hidden="true">
    <polyline points={path} fill="none" stroke="var(--accent)" stroke-width="2" />
  </svg>
{:else}
  <span class="flat">collecting</span>
{/if}

<style>
  svg { flex-shrink: 0; }
  .flat { font-family: var(--font-mono); font-size: 10px; color: var(--dim); }
</style>
