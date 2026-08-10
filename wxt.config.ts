import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser }) => ({
    name: 'maintab',
    description: 'A new tab page for GitHub maintainers.',
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://api.github.com/*'],
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'maintab@connorgallopo.github.io',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
