import uni from '@dcloudio/vite-plugin-uni'
import { uniDesktop } from '@uni-helper/desktop/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [uni(), uniDesktop()],
})
