import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
