import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // better-sqlite3 и др. нативные/рантайм-deps остаются внешними.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          utility: resolve(__dirname, 'src/utility/process.ts')
        }
      }
    }
  },
  preload: {
    // Без externalizeDepsPlugin: sandboxed preload не может require
    // внешние модули — zod бандлится внутрь (чистый JS).
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
