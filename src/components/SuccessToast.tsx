import { DrawnCheck } from './DrawnCheck'

// 记一笔保存、结算确认这几个"成功了"的提示卡片，统一成一套视觉语言——
// 只提供卡片本身，外层的遮罩/定位由调用方自己决定：记一笔保存后是整页
// 替换（按钮暂时按不到没关系），结算确认后页面还能继续操作，外层要用
// pointer-events-none 不挡住底下的点击
export function SuccessToast({ label }: { label: string }) {
  return (
    <div className="pop-in bg-card rounded-3xl px-7 py-6 flex flex-col items-center gap-2 shadow-2xl">
      <DrawnCheck className="w-9 h-9 text-positive" />
      <div className="text-[13.5px] text-ink">{label}</div>
    </div>
  )
}
