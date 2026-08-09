<script lang="ts">
  import { parseRepo } from '../../lib/repos';

  let { repos, onchange }: { repos: string[]; onchange: (repos: string[]) => void } = $props();

  let newRepo = $state('');
  let error = $state('');

  function add() {
    const parsed = parseRepo(newRepo);
    if (!parsed) {
      error = 'Use owner/name or a github.com URL';
      return;
    }
    newRepo = '';
    error = '';
    if (!repos.includes(parsed)) onchange([...repos, parsed]);
  }

  function remove(i: number) {
    onchange(repos.toSpliced(i, 1));
  }
</script>

<ul>
  {#each repos as repo, i}
    <li>
      <span>{repo}</span>
      <button onclick={() => remove(i)} aria-label="Remove {repo}">remove</button>
    </li>
  {/each}
</ul>
<form onsubmit={(e) => { e.preventDefault(); add(); }}>
  <input bind:value={newRepo} placeholder="owner/name" />
  <button type="submit">Add</button>
</form>
{#if error}<p class="err">{error}</p>{/if}

<style>
  ul { list-style: none; display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
  li { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 12px; }
  li button, form button {
    background: none; border: none; color: var(--accent); cursor: pointer;
    font-family: var(--font-mono); font-size: 11px;
  }
  form { display: flex; gap: 8px; }
  input {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; color: var(--ink); font-family: var(--font-mono); font-size: 12px;
    flex: 1;
  }
  .err { font-size: 11px; color: var(--crit); }
</style>
