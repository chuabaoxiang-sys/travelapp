import { getSession } from '../domain/household'

// route-directions / resolve-link-preview / resolve-maps-link 这三个服务端接口只给
// 已登录用户调用（见 api/_lib/verifyHousehold.ts 的 verifyLoggedIn），请求要带上当前
// 登录的 access token。拿不到登录（本地测试模式、还没登录）就干脆不发请求、返回 null——
// 调用方本来就把"请求失败"处理成"没有预览/没有步行时间"的降级样式，这里走同一条路
export async function postWithLogin(path: string, body: unknown): Promise<Response | null> {
  const session = await getSession().catch(() => null)
  if (!session) return null
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
}
