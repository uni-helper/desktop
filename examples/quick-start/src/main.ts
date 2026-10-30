import { createSSRApp } from 'vue'
import App from './App.vue'
import '@uni-helper/desktop/shim'

export function createApp(): { app: App } {
  const app = createSSRApp(App)
  return { app }
}
