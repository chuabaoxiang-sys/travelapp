export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded'

// 优先用系统分享面板（微信/WhatsApp/邮件/AirDrop 等），当前浏览器不支持文件分享
// 时（比如桌面 Firefox）就退回普通下载，不能让用户卡在这里拿不到文件
//
// 故意不用 navigator.canShare({ files: [file] }) 提前判断——不少 Android 版本的
// Chrome/WebView 对某些文件类型（如 xlsx/csv）会误判返回 false，导致明明系统分享
// 面板能处理这个文件，却直接被挡在外面走了下载兜底。改成直接尝试 nav.share()，
// 真正调用失败了再退回下载，比"先猜再试"更可靠。
export async function shareOrDownloadFile(file: File, shareText?: string): Promise<ShareOutcome> {
  const nav = navigator
  if (nav.share) {
    try {
      await nav.share({ files: [file], title: file.name, text: shareText })
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // 分享失败（非用户主动取消）就继续往下走普通下载兜底
    }
  }

  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
