import { useEffect, useState } from 'react'
import { X, Download } from 'lucide-react'

const ANDROID_DISMISS_KEY = 'trip-journal:install-prompt-dismissed'
const IOS_DISMISS_KEY = 'trip-journal:ios-install-hint-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

// iOS上所有浏览器底层都被苹果强制用WebKit（连UA里都带着"Safari"字样），但只有
// Safari本身能把网站真正装成独立全屏APP——Chrome/Edge/Firefox等第三方壳应用，
// 就算分享菜单里也有个"添加到主屏幕"，点了也只是加一个普通网页书签，不会有
// standalone显示模式/离线能力，苹果的平台限制不允许第三方浏览器做到这点。
// 这几个第三方浏览器在UA里都有自己独有的标识，可以跟真正的Safari区分开
function isIOSNonSafariBrowser() {
  return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent)
}

// Chrome/Edge/Android 用系统的 beforeinstallprompt 弹自定义安装条；iOS Safari 完全不支持
// 这个事件（没有编程方式触发安装），只能提示用户自己走"分享→添加到主屏幕"的手动步骤
export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)
  const [iosNonSafari, setIOSNonSafari] = useState(false)

  useEffect(() => {
    if (isStandalone()) return

    function onBeforeInstall(e: Event) {
      e.preventDefault()
      if (localStorage.getItem(ANDROID_DISMISS_KEY)) return
      setDeferredEvent(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setDeferredEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    if (isIOS() && !localStorage.getItem(IOS_DISMISS_KEY)) {
      setShowIOSHint(true)
      setIOSNonSafari(isIOSNonSafariBrowser())
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // 底部固定条要在 pb-4 之外再叠加安全区高度：iOS Safari 的悬浮地址栏/主屏幕
  // 指示条正好占据屏幕最底部这块区域，index.html 里 viewport-fit=cover 又让
  // 页面内容延伸到那块区域下面——不叠加 env(safe-area-inset-bottom) 的话，
  // 这条提示会被 Safari 自己的底栏整个盖住，用户看起来就像"完全没弹提示"
  const safeAreaStyle = { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }

  if (deferredEvent) {
    return (
      <div className="fixed left-0 right-0 bottom-0 z-[100] flex justify-center px-4" style={safeAreaStyle}>
        <div className="w-full max-w-[380px] bg-ink text-paper rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">把旅记安装到主屏幕</div>
            <div className="text-[11px] text-paper/60 mt-0.5">像App一样打开，支持离线使用</div>
          </div>
          <button
            onClick={() => { localStorage.setItem(ANDROID_DISMISS_KEY, '1'); setDeferredEvent(null) }}
            className="text-paper/50 flex-shrink-0"
            title="暂不"
          >
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
          <button
            onClick={async () => {
              await deferredEvent.prompt()
              await deferredEvent.userChoice
              setDeferredEvent(null)
            }}
            className="rounded-xl bg-plan text-card px-3 py-2 flex-shrink-0"
            title="安装"
          >
            <Download className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    )
  }

  if (showIOSHint) {
    return (
      <div className="fixed left-0 right-0 bottom-0 z-[100] flex justify-center px-4" style={safeAreaStyle}>
        <div className="w-full max-w-[380px] bg-ink text-paper rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
          <div className="flex-1 min-w-0 text-[12px] leading-relaxed">
            {iosNonSafari ? (
              <>iOS上只有 <span className="font-medium">Safari</span> 才能把旅记装成独立APP——当前这个浏览器不支持，请用 Safari 重新打开这个网址</>
            ) : (
              <>在 Safari 点击底部<span className="font-medium">分享</span>图标 →「添加到主屏幕」，就能像App一样打开旅记，支持离线使用</>
            )}
          </div>
          <button
            onClick={() => { localStorage.setItem(IOS_DISMISS_KEY, '1'); setShowIOSHint(false) }}
            className="text-paper/50 flex-shrink-0"
            title="关闭"
          >
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    )
  }

  return null
}
