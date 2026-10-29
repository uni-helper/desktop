import { defineConfig } from '@uni-helper/desktop'

export default defineConfig({
  desktop: {
    app: {
      name: 'desktop-quick-start',
      // Omit `icon` to use the built-in uni-helper icon for the window, the
      // macOS Dock, the tray and the installers.
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
