<script lang="ts">
  let { onsave }: { onsave: (pat: string) => void } = $props();
  let pat = $state('');
</script>

<section class="setup">
  <h2>Connect GitHub</h2>
  <p>
    maintab reads your open PRs, notifications, Dependabot alerts, and star counts.
    It needs a classic personal access token with the <code>repo</code>,
    <code>notifications</code>, and <code>security_events</code> scopes.
  </p>
  <a href="https://github.com/settings/tokens/new?scopes=repo,notifications,security_events&description=maintab">
    Create the token on GitHub
  </a>
  <form onsubmit={(e) => { e.preventDefault(); if (pat.trim()) onsave(pat.trim()); }}>
    <input type="password" bind:value={pat} placeholder="ghp_..." aria-label="Personal access token" />
    <button type="submit">Save</button>
  </form>
  <p class="note">The token stays in this extension's storage. It is not encrypted at rest.</p>
</section>

<style>
  .setup {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 28px; max-width: 520px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 14px;
  }
  h2 { font-size: 18px; }
  p, a { font-size: 13px; color: var(--sub); line-height: 1.5; }
  a { color: var(--accent); }
  code { font-family: var(--font-mono); font-size: 12px; }
  form { display: flex; gap: 8px; }
  input {
    flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; color: var(--ink); font-family: var(--font-mono); font-size: 12px;
  }
  button {
    background: var(--accent); color: var(--accent-ink); border: none; border-radius: 6px;
    padding: 8px 16px; font-family: var(--font-display); font-weight: 500; cursor: pointer;
  }
  .note { font-size: 11px; color: var(--dim); }
</style>
