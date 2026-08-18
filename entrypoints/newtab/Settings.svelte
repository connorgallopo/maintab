<script lang="ts">
  import type { Config } from '../../lib/types';
  import { configItem } from '../../lib/storage';
  import RepoListEditor from '../../components/kit/RepoListEditor.svelte';
  import { untrack } from 'svelte';
  import { browser } from '#imports';

  let { config, onclose }: { config: Config; onclose: () => void } = $props();

  let pat = $state(untrack(() => config.pat));
  let pollMinutes = $state(untrack(() => config.pollMinutes));
  let themePin = $state(untrack(() => config.themePin));
  let ignored = $state(untrack(() => [...config.repos.ignored]));
  let includeReviewRequests = $state(untrack(() => config.modules.prs.includeReviewRequests));
  let rowCap = $state(untrack(() => config.modules.prs.rowCap));
  let staleDays = $state(untrack(() => config.modules.prs.staleDays));
  let trackedRepos = $state(untrack(() => [...config.modules.stars.trackedRepos]));

  function clamp(value: number, min: number, max: number, fallback: number): number {
    return Math.min(max, Math.max(min, Number(value) || fallback));
  }

  async function save() {
    const base = $state.snapshot(config);
    await configItem.setValue({
      ...base,
      pat: pat.trim(),
      pollMinutes: clamp(pollMinutes, 1, 60, 5),
      themePin,
      repos: { ...base.repos, ignored: $state.snapshot(ignored) },
      modules: {
        ...base.modules,
        prs: {
          ...base.modules.prs,
          includeReviewRequests,
          rowCap: clamp(rowCap, 3, 20, 8),
          staleDays: clamp(staleDays, 0, 365, 0),
        },
        stars: { ...base.modules.stars, trackedRepos: $state.snapshot(trackedRepos) },
      },
    });
    void browser.runtime.sendMessage({ type: 'refresh' });
    onclose();
  }
</script>

<div class="scrim" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Settings">
  <h2>Settings</h2>

  <label>
    Personal access token
    <input type="password" bind:value={pat} placeholder="ghp_..." />
  </label>
  <p class="hint">Classic token with repo, notifications, and security_events scopes.</p>

  <label>
    Poll interval (minutes)
    <input type="number" min="1" max="60" bind:value={pollMinutes} />
  </label>

  <label>
    Theme
    <select bind:value={themePin}>
      <option value="system">Follow the browser</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>

  <fieldset>
    <legend>Pull requests</legend>
    <label class="checkbox">
      <input type="checkbox" bind:checked={includeReviewRequests} />
      Show PRs waiting on my review
    </label>
    <label>
      Rows
      <input type="number" min="3" max="20" bind:value={rowCap} />
    </label>
    <label>
      Hide after days without activity (0 keeps everything)
      <input type="number" min="0" max="365" bind:value={staleDays} />
    </label>
  </fieldset>

  <fieldset>
    <legend>Ignored repos</legend>
    <RepoListEditor repos={ignored} onchange={(r) => (ignored = r)} />
  </fieldset>

  <fieldset>
    <legend>Star tracking</legend>
    <RepoListEditor repos={trackedRepos} onchange={(r) => (trackedRepos = r)} />
  </fieldset>

  <div class="actions">
    <button class="save" onclick={save}>Save</button>
    <button onclick={onclose}>Cancel</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 40%); }
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw);
    background: var(--card); border-left: 1px solid var(--border);
    padding: 28px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 18px;
  }
  h2 { font-size: 18px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--sub); }
  label.checkbox { flex-direction: row; align-items: center; gap: 8px; }
  input, select {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; color: var(--ink); font-family: var(--font-mono); font-size: 12px;
  }
  input[type="checkbox"] { width: 16px; height: 16px; padding: 0; background: none; border: none; }
  .hint { font-size: 11px; color: var(--dim); }
  fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  legend { font-size: 12px; color: var(--sub); padding: 0 6px; }
  .actions { display: flex; gap: 10px; margin-top: auto; }
  .save {
    background: var(--accent); color: var(--accent-ink); border: none; border-radius: 6px;
    padding: 8px 18px; font-weight: 500; cursor: pointer;
  }
  .actions button:not(.save) { background: none; border: none; color: var(--sub); cursor: pointer; }
</style>
