import { DAY_COLORS } from './colorBlockPalette'

// 分享设置面板里选模板用的手绘缩略图——不是真的渲染对应的模板组件（10套同时
// 挂载在一个弹层里，低端手机会卡，报纸分栏/机场表格这类布局缩小后也会挤成一团），
// 而是每套画几个色块/图形还原它的真实配色和版式特征，让用户不用"盲猜"就知道
// 大概长什么样。颜色直接抄自各模板文件里实际用的色值（DAY_COLORS 那个例外，
// 直接从 ColorBlockTemplate 导出复用，改配色时只用改一处）

export function TicketThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#EFEDE6' }}>
      <div className="absolute inset-x-0 top-0" style={{ height: '55%', background: '#1B3A6B' }} />
      <div className="absolute inset-x-0" style={{ top: '52%', borderTop: '1.5px dashed #EFEDE6' }} />
      <div className="absolute rounded-full" style={{ top: '47%', left: -5, width: 10, height: 10, background: '#EFEDE6' }} />
      <div className="absolute rounded-full" style={{ top: '47%', right: -5, width: 10, height: 10, background: '#EFEDE6' }} />
    </div>
  )
}

export function EditorialThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#FAFAF7' }}>
      <div className="absolute font-black" style={{ top: 8, left: 8, fontSize: 22, color: '#14140F', fontFamily: 'Georgia, serif' }}>08</div>
      <div className="absolute inset-x-0 bottom-0" style={{ height: '26%', background: '#14140F' }} />
    </div>
  )
}

export function CollageThumb() {
  return (
    <div
      className="relative w-full h-full"
      style={{ background: '#E3E9E3' }}
    >
      <div
        className="absolute inset-x-0 top-0"
        style={{ height: '45%', background: '#1E3A2F', backgroundImage: 'radial-gradient(rgba(255,255,255,.15) 1px, transparent 1px)', backgroundSize: '8px 8px' }}
      />
      <div className="absolute" style={{ top: '36%', left: 14, width: 26, height: 8, background: '#F2C230', opacity: 0.8, transform: 'rotate(-4deg)' }} />
    </div>
  )
}

export function JournalThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#F7F3EC' }}>
      <div className="absolute" style={{ top: 10, left: 14, width: 22, height: 8, background: '#282E71', opacity: 0.3, transform: 'rotate(-3deg)' }} />
      <div className="absolute font-bold" style={{ top: 8, right: 10, fontSize: 15, color: '#1F1B16', fontFamily: 'Georgia, serif' }}>旅</div>
      <div
        className="absolute inset-x-0"
        style={{ bottom: 10, left: 10, right: 10, height: 1, background: 'repeating-linear-gradient(90deg, #E8E0D4 0 3px, transparent 3px 6px)' }}
      />
    </div>
  )
}

export function RouteThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#EBEEE9' }}>
      <div className="absolute" style={{ left: 16, top: 6, bottom: 6, width: 2, background: '#D9704F' }} />
      <div className="absolute rounded-full" style={{ left: 12, top: 14, width: 9, height: 9, background: '#D9704F' }} />
      <div className="absolute rounded-full" style={{ left: 12, top: 38, width: 9, height: 9, background: '#D9704F' }} />
    </div>
  )
}

export function StatementThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#111111' }}>
      <div className="absolute font-bold" style={{ top: 10, left: 8, fontSize: 20, color: '#fff', fontFamily: 'ui-monospace, monospace' }}>RM8,420</div>
      <div className="absolute inset-x-0" style={{ bottom: 8, left: 8, right: 8, borderBottom: '1px dotted #555' }} />
    </div>
  )
}

export function DepartureBoardThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#14161A', fontFamily: 'ui-monospace, monospace' }}>
      <div className="absolute font-bold" style={{ top: 8, left: 8, fontSize: 10, color: '#FFB000', letterSpacing: 1 }}>10.20</div>
      <div className="absolute inset-x-0" style={{ top: 24, left: 8, right: 8, height: 1, background: '#2B313B' }} />
      <div className="absolute inset-x-0" style={{ top: 34, left: 8, right: 8, height: 1, background: '#2B313B' }} />
      <div className="absolute rounded-full" style={{ top: 8, right: 8, width: 5, height: 5, background: '#46D07E' }} />
    </div>
  )
}

export function GazetteThumb() {
  return (
    <div className="relative w-full h-full" style={{ background: '#EFEEE9' }}>
      <div className="absolute inset-x-0" style={{ top: 8, left: 6, right: 6, height: 3, borderTop: '2px double #121212' }} />
      <div className="absolute" style={{ top: 16, left: 8, right: '50%', bottom: 8, borderRight: '1px solid #C9C7BE' }} />
      <div className="absolute font-bold" style={{ top: 16, left: '52%', right: 8, bottom: 8, fontSize: 8, color: '#121212', fontFamily: 'Georgia, serif' }}>纪事</div>
    </div>
  )
}

export function ColorBlockThumb() {
  return (
    <div className="w-full h-full flex items-center justify-center gap-1" style={{ background: '#fff' }}>
      {DAY_COLORS.slice(0, 4).map((c) => (
        <div key={c} className="rounded-full" style={{ width: 12, height: 12, background: c }} />
      ))}
    </div>
  )
}

export function GlassThumb() {
  return (
    <div
      className="relative w-full h-full"
      style={{ background: '#0B1730', backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(127,212,255,.25), transparent 60%)' }}
    >
      <div
        className="absolute rounded-md"
        style={{ top: '30%', left: '10%', right: '10%', height: '35%', background: 'rgba(232,239,247,.08)', border: '1px solid rgba(232,239,247,.15)' }}
      />
    </div>
  )
}
