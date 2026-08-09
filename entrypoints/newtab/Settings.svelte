<script lang="ts">
  import type { Config } from '../../lib/types';
  import { configItem } from '../../lib/storage';
  import { parseRepo } from '../../lib/repos';
  import { untrack } from 'svelte';

  let { config, onclose }: { config: Config; onclose: () => void } = $props();

  let pat = $state(untrack(() => config.pat));
  let pollMinutes = $state(untrack(() => config.pollMinutes));
  let themePin = $state(untrack(() => config.themePin));
  let repos = $state(untrack(() => [...config.modules.stars.trackedRepos]));
  let newRepo = $state('');
  let repoError = $state('');

  function addRepo() {
    const parsed = parseRepo(newRepo);
    if (!parsed) {
      repoError = 'Use owner/name or a github.com URL';
      return;
    }
    if (!repos.includes(parsed)) repos.push(parsed);
    newRepo = '';
    repoError = '';
  }

  async function save() {
    await configItem.setValue({
      pat: pat.trim(),
      pollMinutes: Math.min(60, Math.max(1, Number(pollMinutes) || 5)),
      themePin,
      modules: { stars: { trackedRepos: repos } },
    });
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
    <legend>Star tracking</legend>
    <ul>
      {#each repos as repo, i}
        <li>
          <span>{repo}</span>
          <button onclick={() => repos.splice(i, 1)} aria-label="Remove {repo}">remove</button>
        </li>
      {/each}
    </ul>
    <form onsubmit={(e) => { e.preventDefault(); addRepo(); }}>
      <input bind:value={newRepo} placeholder="owner/name" />
      <button type="submit">Add</button>
    </form>
    {#if repoError}<p class="err">{repoError}</p>{/if}
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
  input, select {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; color: var(--ink); font-family: var(--font-mono); font-size: 12px;
  }
  .hint, .err { font-size: 11px; color: var(--dim); }
  .err { color: var(--crit); }
  fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  legend { font-size: 12px; color: var(--sub); padding: 0 6px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  li { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 12px; }
  li button, form button {
    background: none; border: none; color: var(--accent); cursor: pointer;
    font-family: var(--font-mono); font-size: 11px;
  }
  form { display: flex; gap: 8px; }
  form input { flex: 1; }
  .actions { display: flex; gap: 10px; margin-top: auto; }
  .save {
    background: var(--accent); color: var(--accent-ink); border: none; border-radius: 6px;
    padding: 8px 18px; font-weight: 500; cursor: pointer;
  }
  .actions button:not(.save) { background: none; border: none; color: var(--sub); cursor: pointer; }
</style>
