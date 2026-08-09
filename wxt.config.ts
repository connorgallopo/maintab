import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'maintab',
    description: 'A new tab page for GitHub maintainers.',
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://api.github.com/*'],
  },
});
