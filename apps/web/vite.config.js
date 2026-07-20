import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const buildOutDir = env.VITE_BUILD_OUT_DIR || 'dist'
  // 开发时统一把 /api 代理到本地 FastAPI（apps/server）
  const apiTarget = String(env.VITE_API_PROXY_TARGET || '').trim() || 'http://localhost:8000'

  return {
    plugins: [tailwindcss(), vue(), vueJsx(), vueDevTools()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3102,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    worker: {
      // Lossless WebP encoding is code-split inside a module worker so large
      // 4K/8K jobs do not freeze the main UI thread.
      format: 'es',
    },
    build: {
      outDir: buildOutDir,
      emptyOutDir: true,
      assetsDir: 'assets',
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 750,
      sourcemap: false,
      rollupOptions: {
        onwarn(warning, warn) {
          if (
            warning.code === 'INVALID_ANNOTATION' &&
            String(warning.message || '').includes('#__PURE__')
          ) {
            return
          }
          warn(warning)
        },
        output: {
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/three/')) return 'vendor-three'
            if (id.includes('/@vue/') || id.includes('/vue/') || id.includes('/pinia/')) {
              return 'vendor-vue'
            }
            if (id.includes('/bootstrap/')) return 'vendor-bootstrap'
            if (id.includes('/gsap/') || id.includes('/animejs/')) return 'vendor-animation'
            return 'vendor'
          },
        },
      },
    },
  }
})
