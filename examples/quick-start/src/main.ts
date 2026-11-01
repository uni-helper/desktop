import { createSSRApp } from 'vue'
import App from './App.vue'

export function createApp(): { app: App } {
  const app = createSSRApp(App)
  return { app }
}
