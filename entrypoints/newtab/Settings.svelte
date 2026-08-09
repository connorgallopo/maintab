<script lang="ts">
  let { onclose }: { onclose: () => void } = $props();
</script>
<div role="dialog"><button onclick={onclose}>close</button></div>
