import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: 'desktop-quick-start',
      // icon: 'static/logo.png',
    },
    window: {
      width: 420,
      height: 760,
    },
    // dev: { url: 'http://localhost:5173' },
    // updater: { provider: 'generic', url: 'https://example.com/updates' },
  },
})
