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
  const localApiTarget = 'http://127.0.0.1:8787'
  const defaultRemoteWallhavenProxy = 'https://walleven-wallhaven-proxy.lcmzwq.workers.dev'
  const wallhavenProxyTarget =
    String(env.VITE_WALLHAVEN_PROXY_TARGET || '').trim() ||
    (mode === 'development' ? defaultRemoteWallhavenProxy : localApiTarget)
  const wallhavenDevProxy = {
    target: wallhavenProxyTarget,
    changeOrigin: true,
  }

  return {
    plugins: [tailwindcss(), vue(), vueJsx(), vueDevTools()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 3102,
      // Allow payment-callback tunnels (ngrok / localtunnel) in local dev.
      allowedHosts:
        mode === 'development'
          ? ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io', '.loca.lt']
          : undefined,
      proxy: {
        '/api/user': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/admin': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/client': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/public': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/insights': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/ai': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/ai-temp-upload': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        '/api/ai-temp': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
        // 代理缩略图请求
        '/proxy': {
          target: 'https://th.wallhaven.cc',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/proxy/, ''),
        },
        '/api/wallhaven': {
          target: 'https://wallhaven.cc/api/v1',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/wallhaven/, ''),
        },
        '/api/search': wallhavenDevProxy,
        '/api/image-proxy': wallhavenDevProxy,
        '/api/image': wallhavenDevProxy,
        '/api/collections': wallhavenDevProxy,
        '/api/health': {
          target: localApiTarget,
          changeOrigin: true,
        },
      },
    },
    worker: {
      // Lossless WebP encoding is code-split inside a module worker so large
      // 4K/8K jobs do not freeze the main UI thread.
      format: 'es',
    },
    // 构建配置
    build: {
      // 输出目录
      outDir: buildOutDir,
      // 清空旧 hash 资源，避免静态部署继续命中旧入口
      emptyOutDir: true,
      // 生成静态资源的存放路径
      assetsDir: 'assets',
      // 小于此阈值的导入或引用资源将内联为base64编码
      assetsInlineLimit: 4096,
      // 启用/禁用CSS代码拆分
      cssCodeSplit: true,
      // Three.js 是按需加载的大依赖；拆分后把告警阈值调到贴近真实边界。
      chunkSizeWarningLimit: 750,
      // 构建后是否生成source map文件
      sourcemap: false,
      // 自定义底层的Rollup打包配置
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
          // 静态资源分类打包
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('/three/examples/')) return 'vendor-three-extras'
            if (id.includes('/three/')) return 'vendor-three'
            if (id.includes('/iztro/')) return 'vendor-iztro'
            if (id.includes('/@vue/') || id.includes('/vue/') || id.includes('/pinia/')) {
              return 'vendor-vue'
            }
            if (id.includes('/axios/')) return 'vendor-http'
            if (id.includes('/echarts/')) return 'vendor-charts'
            if (id.includes('/bootstrap/')) return 'vendor-bootstrap'
            if (id.includes('/gsap/') || id.includes('/motion-v/')) return 'vendor-animation'
            if (id.includes('/ogl/')) return 'vendor-webgl'
            return 'vendor'
          },
        },
      },
    },
  }
})
