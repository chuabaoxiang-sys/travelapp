// 判断当前是不是跑在"已安装成独立APP"的显示模式下（而不是普通浏览器标签页里）。
// InstallPrompt.tsx和ShareSettingsSheet.tsx都要用同一个判断，抽出来共用一份。
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
