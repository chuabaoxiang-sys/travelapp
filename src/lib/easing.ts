// 缓动函数单独抽出来，方便脱离 requestAnimationFrame/React 直接做单元测试——
// 曲线本身（先快后慢，t=1精确落在终点）才是这个功能真正值得验证的部分，
// rAF循环只是搬运数据，测了也测不出什么
export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}
