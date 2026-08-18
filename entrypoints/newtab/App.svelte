<!-- entrypoints/newtab/App.svelte -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from '#imports';
  import type { Config, ModulesState, SyncState, Tile } from '../../lib/types';
  import { configItem, syncItem, modulesItem } from '../../lib/storage';
  import { markSeen } from '../../cards/prs';
  import { markRead } from '../../cards/notifications';
  import Masthead from '../../components/kit/Masthead.svelte';
  import StatTile from '../../components/kit/StatTile.svelte';
  import Card from '../../components/kit/Card.svelte';
  import SetupCard from '../../components/kit/SetupCard.svelte';
  import Banner from '../../components/kit/Banner.svelte';

  let { config: c0, sync: s0, modules: m0 }: { config: Config; sync: SyncState; modules: ModulesState } = $props();

  let config = $state(untrack(() => c0));
  let sync = $state(untrack(() => s0));
  let modules = $state(untrack(() => m0));
  let settingsOpen = $state(false);
  let Settings: typeof import('./Settings.svelte').default | null = $state(null);

  $effect(() => {
    const un = [
      configItem.watch((v) => (config = v)),
      syncItem.watch((v) => (sync = v)),
      modulesItem.watch((v) => (modules = v)),
    ];
    return () => un.forEach((u) => u());
  });

  $effect(() => {
    document.documentElement.dataset.theme = config.themePin === 'system' ? '' : config.themePin;
  });

  $effect(() => {
    if (config.pat && Date.now() - sync.lastSyncAt > config.pollMinutes * 60_000) refresh();
  });

  function refresh() {
    void browser.runtime.sendMessage({ type: 'refresh' });
  }

  async function openSettings() {
    Settings ??= (await import('./Settings.svelte')).default;
    settingsOpen = true;
  }

  async function savePat(pat: string) {
    await configItem.setValue({ ...$state.snapshot(config), pat });
    refresh();
  }

  function headerClick(href: string): boolean {
    if (href.startsWith('settings:')) {
      void openSettings();
      return true;
    }
    return false;
  }

  const tiles = $derived(
    [modules.prs?.slice.tile, modules.notifications?.slice.tile, modules.vulns?.slice.tile]
      .filter((t): t is Tile => Boolean(t)),
  );
  const busy = $derived(sync.inFlightSince > 0);
</script>

<main class="wrap">
  <Masthead lastSyncAt={sync.lastSyncAt} {busy} onrefresh={refresh} />

  {#if !config.pat}
    <SetupCard onsave={savePat} />
  {:else}
    {#if sync.authError}
      <Banner text="GitHub rejected the token." actionLabel="Open settings" onaction={openSettings} />
    {/if}

    <div class="stats">
      {#each tiles as tile}<StatTile {tile} />{/each}
    </div>

    {#if modules.prs}
      <div class="primary">
        <Card slice={modules.prs.slice} onheader={headerClick} onrow={(id) => void markSeen(id)} />
      </div>
    {/if}

    <div class="secondary">
      {#if modules.notifications}<Card slice={modules.notifications.slice} onheader={headerClick} onrowact={(id) => void markRead(id)} />{/if}
      {#if modules.vulns}<Card slice={modules.vulns.slice} onheader={headerClick} />{/if}
      {#if modules.stars}<Card slice={modules.stars.slice} onheader={headerClick} />{/if}
    </div>
  {/if}

  {#if settingsOpen && Settings}
    <Settings {config} onclose={() => (settingsOpen = false)} />
  {/if}
</main>

<button class="gear" onclick={openSettings} aria-label="Settings">&#9881;</button>

<style>
  .wrap { max-width: 1080px; margin: 0 auto; padding: 6vh 32px 48px; }
  .stats {
    display: flex; background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; margin-bottom: 16px;
  }
  .primary { margin-bottom: 16px; }
  .secondary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .gear {
    position: fixed; right: 18px; bottom: 18px; background: none; border: none;
    color: var(--dim); font-size: 18px; cursor: pointer;
  }
  .gear:hover { color: var(--sub); }
  @media (max-width: 860px) {
    .secondary { grid-template-columns: 1fr; }
    .stats { flex-wrap: wrap; }
  }
</style>
