<script lang="ts">
  let { text, actionLabel, onaction }: { text: string; actionLabel: string; onaction: () => void } = $props();
</script>

<div class="banner" role="alert">
  <span>{text}</span>
  <button onclick={onaction}>{actionLabel}</button>
</div>

<style>
  .banner {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    background: color-mix(in srgb, var(--crit) 12%, var(--card));
    border: 1px solid var(--crit); border-radius: 12px;
    padding: 10px 20px; margin-bottom: 16px; font-size: 13px;
  }
  button {
    background: none; border: none; color: var(--accent); cursor: pointer;
    font-family: var(--font-mono); font-size: 12px;
  }
</style>
