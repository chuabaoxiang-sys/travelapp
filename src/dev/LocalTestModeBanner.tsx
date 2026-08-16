import { disableLocalTestMode } from './localTestMode'

// 用悬浮按钮而不是顶部横幅——横幅会挤占一行高度，跟各个Tab里假设"父容器=
// 整个视口高度"的h-full布局打架；悬浮在最上层不影响任何现有布局
export function LocalTestModeBanner() {
  return (
    <button
      onClick={() => {
        disableLocalTestMode()
        window.location.reload()
      }}
      className="fixed bottom-4 right-4 z-50 rounded-full bg-plan text-card text-[11.5px] px-3.5 py-2 shadow-lg"
    >
      本地测试模式 · 点击退出
    </button>
  )
}
