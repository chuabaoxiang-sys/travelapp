// Vercel Edge Middleware：整站 HTTP Basic Auth 密码墙。
//
// 为什么需要这个：Supabase 的 anon key 天然会出现在客户端 JS 包里，任何人打开
// 浏览器开发者工具都能看到，所以只在 App 内部（比如 MemberGate 前）加一个密码
// 弹窗毫无意义——绕过前端界面直接调 Supabase 的 REST API 完全不受影响。真正的
// 防护必须挡在"整个网站能不能被打开"这一层：挡在这里，连 JS 包本身都下载不到，
// 自然也拿不到里面的 Supabase 网址和 key。
//
// matcher 覆盖所有路径（包括静态资源），账号密码来自 Vercel 项目的环境变量
// BASIC_AUTH_USER / BASIC_AUTH_PASSWORD（只存在 Vercel 后台，不写入代码仓库）。
export const config = {
  matcher: '/:path*',
}

export default async function middleware(request: Request) {
  const expectedUser = process.env.BASIC_AUTH_USER
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD

  // 环境变量没配置时不应该把网站彻底锁死（比如本地 vercel dev 忘了设置），
  // 但生产环境部署前必须在 Vercel 后台配好这两个变量——见 docs/deployment.md
  if (!expectedUser || !expectedPassword) {
    return
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice('Basic '.length))
    const separatorIndex = decoded.indexOf(':')
    const user = decoded.slice(0, separatorIndex)
    const password = decoded.slice(separatorIndex + 1)
    if (user === expectedUser && password === expectedPassword) {
      return
    }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="TripJournal"',
    },
  })
}
