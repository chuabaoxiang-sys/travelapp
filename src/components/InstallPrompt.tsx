import { useEffect, useState } from 'react'

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

// Chrome/Edge/Android 用系统的 beforeinstallprompt 弹自定义安装条；iOS Safari 完全不支持
// 这个事件（没有编程方式触发安装），只能提示用户自己走"分享→添加到主屏幕"的手动步骤
export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)

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
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (deferredEvent) {
    return (
      <div className="fixed left-0 right-0 bottom-0 z-[100] flex justify-center px-4 pb-4">
        <div className="w-full max-w-[380px] bg-ink text-paper rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">把旅记安装到主屏幕</div>
            <div className="text-[11px] text-paper/60 mt-0.5">像App一样打开，支持离线使用</div>
          </div>
          <button
            onClick={() => { localStorage.setItem(ANDROID_DISMISS_KEY, '1'); setDeferredEvent(null) }}
            className="text-[11px] text-paper/50 flex-shrink-0"
          >
            暂不
          </button>
          <button
            onClick={async () => {
              await deferredEvent.prompt()
              await deferredEvent.userChoice
              setDeferredEvent(null)
            }}
            className="rounded-xl bg-plan text-card px-3 py-2 text-[12.5px] font-medium flex-shrink-0"
          >
            安装
          </button>
        </div>
      </div>
    )
  }

  if (showIOSHint) {
    return (
      <div className="fixed left-0 right-0 bottom-0 z-[100] flex justify-center px-4 pb-4">
        <div className="w-full max-w-[380px] bg-ink text-paper rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3">
          <div className="flex-1 min-w-0 text-[12px] leading-relaxed">
            在 Safari 点击底部<span className="font-medium">分享</span>图标 →「添加到主屏幕」，就能像App一样打开旅记，支持离线使用
          </div>
          <button
            onClick={() => { localStorage.setItem(IOS_DISMISS_KEY, '1'); setShowIOSHint(false) }}
            className="text-[13px] text-paper/50 flex-shrink-0"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  return null
}
