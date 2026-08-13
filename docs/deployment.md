# 部署运维手册

## 技术栈概览

- **前端**：Vite + React 19 + TypeScript，Tailwind CSS v4（`@tailwindcss/vite`）
- **本地数据层**：Dexie.js（IndexedDB封装），是目前**唯一**的数据来源——没有后端，没有真正的云端数据库
- **PWA**：`vite-plugin-pwa`（`generateSW`模式），提供Service Worker离线缓存 + 安装能力
- **地图/地点搜索**：Leaflet + react-leaflet + OpenStreetMap瓦片，Nominatim免费地理编码
- **导出**：`xlsx`（SheetJS）在浏览器端直接生成Excel
- **测试**：Vitest + fake-indexeddb（给Dexie在Node环境提供内存版IndexedDB）
- **云端同步**：`@supabase/supabase-js` 连接到真实的 Supabase 项目（Postgres + REST API），`src/db/sync.ts` 实现离线outbox队列的推送/拉取，已接通并验证
- **部署层密码墙**：`middleware.ts`（Vercel Edge Middleware）在整站前面加一道 HTTP Basic Auth，见下方"部署到 Vercel"一节
- **已安装但尚未接入使用**：`react-router-dom`——为后续只读分享链接路由预留，当前代码里还没有真正调用

## 架构概览：本地优先 + 云端同步

所有写操作先落地到用户浏览器的IndexedDB（Dexie），**UI永远只读写本地数据，不等网络**——即使完全离线也能完整使用记账、预算、分账结算、导出功能。每次本地写操作会记一条到本地的`outbox`队列，联网时`src/db/sync.ts`按顺序把队列推送到Supabase，同时定期从Supabase拉取其他设备写入的数据合并回本地（冲突策略：按`updatedAt`时间戳，后写覆盖）。这个架构的意义是：即使Supabase一时不可用，APP本身完全不受影响，只是同步暂停、下次联网自动补上。

## 本地开发

```bash
npm install
npm run dev        # 启动开发服务器，默认 http://localhost:5173
```

**⚠️ 如果要在本地测试 `api/route-directions.ts`（相邻地点通勤提示用的接口）**：`npm run dev` 是纯 Vite，不会跑 `/api` 目录下的 Vercel serverless/edge 函数。本地需要改用 `vercel dev`（先 `npm i -g vercel`，项目根目录下跑一次 `vercel link` 关联到Vercel项目，然后 `vercel dev`），并在项目根目录建一个 `.env.local`（或用 `vercel env pull`）写入 `ORS_API_KEY=你的key`。正式部署到 Vercel 后不受影响，`api/` 目录会被自动识别为 serverless 函数。

## 测试

```bash
npm run test        # 跑一次全部单元测试（Vitest）
npm run test:watch  # 监听模式，改代码自动重跑
```

金额相关的核心计算逻辑（`src/domain/splits.ts`、`src/domain/budgets.ts`、`src/domain/exportRenderers.ts`）都有单元测试覆盖，改动这几个文件后务必先跑一次测试再提交。

## 生产构建

```bash
npm run build       # tsc -b 类型检查 + vite build，产出到 dist/
npm run preview     # 本地起一个静态服务器预览生产构建（用于验证PWA/Service Worker行为）
```

**务必用 `npm run build` 而不是零散的 `tsc --noEmit` 做最终验证**——项目用了TypeScript的项目引用（project references），`tsc -b` 的构建模式比单独跑 `tsc --noEmit` 更严格，历史上发现过好几个只有 `tsc -b` 才会报出来的类型错误。

## 部署到 Vercel

在Vercel后台关联这个Git仓库，Build Command用 `npm run build`，Output Directory填 `dist`。

**PWA的两个硬性要求**：
1. 必须走 **HTTPS**（Vercel默认就是HTTPS，本地开发用 `localhost` 也算例外允许）
2. `manifest.webmanifest` 和 Service Worker 的作用域要和实际部署的域名/路径匹配——如果部署到子路径（不是根目录），需要额外调整 `vite.config.ts` 里的 `base` 配置和 PWA 插件的 `scope`/`start_url`

### ⚠️ 部署前必须先配好这4个环境变量，否则会出现"裸奔"的窗口期

在Vercel项目设置的 Environment Variables 里配置（Production + Preview 都要配）：

| 变量名 | 用途 | 值从哪来 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase项目地址 | Supabase后台 → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase匿名key（会出现在客户端JS包里，这是正常的，正因为如此才需要下面两个变量做的密码墙） | 同上 |
| `BASIC_AUTH_USER` | 密码墙的账号 | 自己定，全家共用一个即可 |
| `BASIC_AUTH_PASSWORD` | 密码墙的密码 | 自己定，通过安全渠道（不是明文写在公开地方）告知家人 |
| `ORS_API_KEY` | 行程页"相邻地点通勤提示"用的真实步行路线API key（**不带`VITE_`前缀**——特意存成服务端专属变量，配合`api/route-directions.ts`这个Edge Function代理调用，key不会出现在前端JS包里） | 去 [openrouteservice.org](https://openrouteservice.org/dev/#/signup) 免费注册，Dashboard里生成一个key，免费额度每天2000次步行路线请求 |

**务必先配好这5个变量再触发部署**——如果先部署、后补环境变量，中间会有一段"任何人都能直接打开网址、直接读写Supabase数据"的窗口期。少配`ORS_API_KEY`不会有安全风险（只是通勤提示功能会静默不显示），但建议一起配上。

`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` 由项目根目录的 `middleware.ts`（Vercel Edge Middleware）读取，在请求到达APP的任何一个文件（包括JS/CSS等静态资源）之前先要求HTTP Basic Auth验证——这是因为 `VITE_SUPABASE_ANON_KEY` 无论如何都会出现在打包后的JS代码里（这是Supabase的正常设计，前端应用本来就要能直接连数据库），单纯在APP内部加一个登录弹窗挡不住"绕过界面直接调Supabase API"，必须挡在"整站能不能被打开"这一层才有效。

**忘记密码墙的账号密码怎么办**：登录Vercel后台 → 项目 → Settings → Environment Variables，直接查看/修改 `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` 的值，改完后触发一次重新部署（Redeploy）才会生效。

### Supabase 迁移文件

跑 `supabase/migrations/` 目录下的SQL文件（按文件名顺序：0001 → 0002 → 0003），在Supabase后台的SQL Editor里手动执行。这些文件已经跑过、验证过，仅在需要重建一个新Supabase项目时才需要重新执行。

## 已知限制（部署前必须让使用者知情）

1. **云端同步已接通**：数据会自动同步到Supabase，多设备之间会互相合并（"N条待同步"角标现在会随同步成功而下降）。但冲突策略是"按更新时间后写覆盖"，不是真正的合并——两人同时离线改同一条记录，其中一次编辑会丢失。这是为单个家庭低并发场景做的简化，用户已知情。
2. **密码墙是全家共用一道门，不是每人独立账号**：Vercel部署层的HTTP Basic Auth挡住了陌生人/爬虫直接访问，但APP内部选身份记账仍然是"选名字即可，不需要密码"——任何知道密码墙账号密码的人都能以任何已有成员的身份记账、改动数据。这是为家庭内部信任场景做的简化，不是面向陌生人开放场景的安全边界；如果未来要把APP开放给家庭以外的人用，需要重新设计成"每人真实账号登录"。
3. **只读分享链接尚未实现**：`Trip.publicShareEnabled`/`publicShareToken` 字段和相关UI设计都已就绪，云端同步现在也已经接通，技术上不再被阻塞，但这部分功能本身还没有开始实现。
4. **iOS Safari 的PWA支持历史上比Android Chrome更受限**（没有`beforeinstallprompt`事件，安装/离线行为也有一些平台差异），部署后建议在真实iPhone上做一次完整验证（安装、离线打开、记账）。
5. **单个JS包体积已经超过500KB**（构建时会有警告，主要是`xlsx`和`leaflet`这两个较大的库）。功能上不影响使用，但如果后续在意首屏加载速度，可以考虑用动态`import()`把导出功能和地图功能按需加载，不在这次范围内处理。

## 故障排查

- **打开就白屏**：先看浏览器控制台报错。这个项目里发生过的一个真实教训：Dexie的表级hook（`src/db/dexie.ts`里的`registerOutboxHooks`）依赖模块顶层变量声明顺序——如果以后改这个文件时把某个常量的声明挪到了`export const db = new TripJournalDB()`之后，会触发"暂时性死区"报错导致整个APP崩溃且没有任何UI提示。改这个文件后务必实际跑一次 `npm run build` + 打开页面验证，不能只看类型检查通过。
- **改了代码但页面显示还是旧的**：Service Worker会缓存应用外壳。开发环境下可以在浏览器devtools的Application/Application面板里手动"Unregister"当前的Service Worker再刷新；生产环境正常情况下`vite-plugin-pwa`的`autoUpdate`策略会自动检测新版本并更新，用户可能需要完全关闭再重新打开一次APP才会生效。
- **地图/地点搜索没反应**：Nominatim是免费公共服务，有请求频率限制，本地开发/测试时如果短时间内触发了限流，稍等一下再试。
- **部署后打开网址一直弹密码框/密码正确也进不去**：先确认Vercel后台的`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`两个环境变量确实配置在当前生效的环境（Production还是Preview，取决于访问的是哪个域名），改环境变量后必须触发一次新的部署（Redeploy）才会生效，改完不重新部署，线上跑的还是旧的`middleware.ts`执行环境快照。密码框本身是浏览器原生弹出的，跟APP代码无关，清除浏览器保存的密码或换个浏览器/无痕窗口可以重新触发输入。
