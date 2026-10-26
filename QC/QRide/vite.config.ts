import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, root, 'VITE_')
  return {
    root,
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY': JSON.stringify(process.env.QRIDE_GOOGLE_MAPS_BROWSER_KEY ?? env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? ''),
      'import.meta.env.VITE_GOOGLE_MAPS_MAP_ID': JSON.stringify(process.env.QRIDE_GOOGLE_MAPS_MAP_ID ?? env.VITE_GOOGLE_MAPS_MAP_ID ?? ''),
    },
    server: {
      fs: { allow: [root, fileURLToPath(new URL('../../apps/shared', import.meta.url)), fileURLToPath(new URL('../../src/shared/maps', import.meta.url)), fileURLToPath(new URL('../../countries/canada', import.meta.url))] },
      host: '127.0.0.1', port: 5190, strictPort: true,
    },
    preview: { host: '127.0.0.1', port: 5190, strictPort: true },
    build: { outDir: 'dist', emptyOutDir: true },
  }
})
