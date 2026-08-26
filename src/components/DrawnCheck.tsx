// 用SVG的pathLength="1"技巧让勾号真的"画出来"，而不是整个图标一次性
// 出现——数值定成1之后stroke-dasharray/stroke-dashoffset就能直接用
// 0~1表示0%~100%的进度，不用去量lucide这个具体路径的真实长度
//
// 路径的点顺序特意跟lucide原版Check图标（M20 6 9 17l-5-5，从右上长笔画
// 画起）反过来写成"M4 12 9 17 20 6"——形状完全一样，但画的方向变成从
// 左边那一小笔开始、最后在右上角长笔画收尾，跟手写"✓"的自然顺序（先下
// 后上扬）一致，也是常见APP打勾动画的通用做法
export function DrawnCheck({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`drawn-check ${className}`}>
      <path d="M4 12 9 17 20 6" pathLength="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
