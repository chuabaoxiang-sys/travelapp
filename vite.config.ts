import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // 开发环境也启用 Service Worker，方便测试离线打开/更新提示，不用每次都跑 build
      devOptions: { enabled: true },
      manifest: {
        id: '/',
        name: '旅记 · TripJournal',
        short_name: '旅记',
        description: '家庭旅行行程与账目记录',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#F7F3EC',
        theme_color: '#4C1D95',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 把整个应用外壳（HTML/JS/CSS/图标）预缓存，保证断网也能直接打开；
        // 地图瓦片/地点搜索这些第三方请求不缓存，本来就要求联网才有意义
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
})
