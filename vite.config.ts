import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// 构建时把当前git commit（短SHA）和构建时间打进产物里，给"检查更新"那个功能
// 和反馈记录用——不依赖Vercel专属的环境变量（比如VERCEL_GIT_COMMIT_SHA），
// 本地 npm run build 也能拿到一样的东西，不多绑定一个部署平台
function getCommitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(getCommitSha()),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // 手动注册（src/main.tsx 里 registerSW），而不是用插件自动注入的注册脚本——
      // 手动注册才能拿到 registration 对象，设置"定期主动检查更新"的逻辑（见 main.tsx）。
      // 自动注入脚本没有暴露这个钩子，只会被动依赖浏览器自己的更新检查时机（通常只在
      // 真正冷启动时才检查，PWA从后台切回前台不会主动检查，导致必须完全关闭重开才能
      // 拉到新版本）
      injectRegister: false,
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
        // 真实bug教训：默认（false）生成的sw.js会把skipWaiting做成"要等一条
        // SKIP_WAITING消息才触发"，但一直没有代码在发这条消息——新版本永远卡在
        // "装完了、没人叫它接管"，不管用户怎么刷新都没用。这里改成无条件自动跳过等待
        // +立刻接管所有已经打开的页面（clientsClaim），配合main.tsx里监听
        // controllerchange自动刷新，更新才能真正做到"不用用户操心"
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
