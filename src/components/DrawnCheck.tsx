// 用SVG的pathLength="1"技巧让勾号真的"画出来"，而不是整个图标一次性
// 出现——数值定成1之后stroke-dasharray/stroke-dashoffset就能直接用
// 0~1表示0%~100%的进度，不用去量lucide这个具体路径的真实长度
export function DrawnCheck({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`drawn-check ${className}`}>
      <path d="M20 6 9 17l-5-5" pathLength="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
