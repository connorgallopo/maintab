<script lang="ts">
  import type { Config } from '../../lib/types';
  let { config, onclose }: { config: Config; onclose: () => void } = $props();
  void config;
</script>
<div role="dialog"><button onclick={onclose}>close</button></div>
