export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded'

// 优先用系统分享面板（微信/WhatsApp/邮件/AirDrop 等），当前浏览器不支持文件分享
// 时（比如桌面 Firefox）就退回普通下载，不能让用户卡在这里拿不到文件
export async function shareOrDownloadFile(file: File, shareText?: string): Promise<ShareOutcome> {
  const nav = navigator
  if (nav.share && nav.canShare?.({ files: [file] })) {
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
