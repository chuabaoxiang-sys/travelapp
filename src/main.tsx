import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'

// 新版本部署后，后台的 service worker 会自动更新完成（registerType: 'autoUpdate'），
// 但已经打开的这个标签页不会自动感知——不刷新一次的话，页面还在用旧的、服务器上
// 已经不存在的文件名，会一直报 404。这里监听"新 SW 已接管"事件，自动刷新一次，
// 用户不用再手动清缓存
if ('serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

// 光有上面这个监听还不够：浏览器默认只在"真正冷启动"（完全关闭APP再打开）时才会去
// 检查有没有新的 service worker——PWA从后台切回前台并不会主动触发这个检查，导致
// 用户必须完全关闭重开才能拉到新版本，对测试用户来说太麻烦了。这里手动注册（而不是
// 用插件自动注入的默认注册脚本，见 vite.config.ts 的 injectRegister: false），换来
// registration 对象，主动定期 + 每次切回前台时都去问一句"有新版本吗"
const UPDATE_CHECK_INTERVAL_MS = 60_000

registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // registration.update() 偶尔会失败（比如短暂离线、开发环境下的 dev SW 行为跟生产
    // 环境不完全一样）——不接住的话每次失败都是一条未捕获的 promise rejection，
    // 刷屏控制台。反正只是"顺便问一句有没有更新"，失败就等下一轮定时/下一次切前台
    // 再试，不需要额外处理
    const checkForUpdate = () => registration.update().catch(() => {})
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
