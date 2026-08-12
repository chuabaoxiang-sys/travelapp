export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded'

export interface ShareResult {
  outcome: ShareOutcome
  // 只在 outcome === 'downloaded' 且是分享真的失败了才退回来的情况下才有值——
  // 手机浏览器devtools不好折腾，把失败原因直接带出来才能知道下一步该查什么
  failureReason?: string
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 真机测试实测报错 NotAllowedError: Permission denied——安卓部分版本的Chrome
// 要求 navigator.share() 必须是"用户手势"的直接延续，中间隔了生成文件这段
// await（哪怕很快）就会被判定手势已经过期。所以不能在"点击→生成文件→分享"
// 这一条await链路里调用share()，必须让分享按钮自己的点击事件里，不经过任何
// await 就直接调用 navigator.share()——也就是调用方要把"生成文件"和"调用分享"
// 拆成两次独立的用户点击，这个函数只负责后一半：文件已经在手上时，直接分享。
export async function shareReadyFile(file: File, shareText?: string): Promise<ShareResult> {
  if (!navigator.share) {
    downloadFile(file)
    return { outcome: 'downloaded', failureReason: '此浏览器不支持系统分享（navigator.share 不存在）' }
  }
  try {
    await navigator.share({ files: [file], title: file.name, text: shareText })
    return { outcome: 'shared' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { outcome: 'cancelled' }
    const failureReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    downloadFile(file)
    return { outcome: 'downloaded', failureReason }
  }
}
