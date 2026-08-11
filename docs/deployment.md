# 部署运维手册

## 技术栈概览

- **前端**：Vite + React 19 + TypeScript，Tailwind CSS v4（`@tailwindcss/vite`）
- **本地数据层**：Dexie.js（IndexedDB封装），是目前**唯一**的数据来源——没有后端，没有真正的云端数据库
- **PWA**：`vite-plugin-pwa`（`generateSW`模式），提供Service Worker离线缓存 + 安装能力
- **地图/地点搜索**：Leaflet + react-leaflet + OpenStreetMap瓦片，Nominatim免费地理编码
- **导出**：`xlsx`（SheetJS）在浏览器端直接生成Excel
- **测试**：Vitest + fake-indexeddb（给Dexie在Node环境提供内存版IndexedDB）
- **已安装但尚未接入使用**：`@supabase/supabase-js`、`react-router-dom`——为后续云端同步和分享链接路由预留，当前代码里还没有真正调用

## ⚠️ 当前架构最重要的一点：完全没有后端

这个项目目前是**纯客户端应用**，所有数据存在用户浏览器的IndexedDB里，**不需要服务器就能完整运行所有功能**（包括记账、预算、分账结算、导出）。这既是优点（部署极其简单，静态托管即可）也是当前最大的限制（见下方"已知限制"）。

## 本地开发

```bash
npm install
npm run dev        # 启动开发服务器，默认 http://localhost:5173
```

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

## 部署到静态托管（现在就能做）

因为没有后端依赖，`dist/` 目录可以直接扔给任何静态托管服务，例如：
- **Vercel**：`vercel deploy`，或者直接在Vercel后台关联这个Git仓库，Build Command用 `npm run build`，Output Directory填 `dist`
- **Netlify**：同理，Build Command `npm run build`，Publish directory `dist`

**PWA的两个硬性要求**：
1. 必须走 **HTTPS**（Vercel/Netlify默认都是HTTPS，本地开发用 `localhost` 也算例外允许）
2. `manifest.webmanifest` 和 Service Worker 的作用域要和实际部署的域名/路径匹配——如果部署到子路径（不是根目录），需要额外调整 `vite.config.ts` 里的 `base` 配置和 PWA 插件的 `scope`/`start_url`

## 环境变量

目前代码里**没有读取任何环境变量**（`@supabase/supabase-js` 装了但还没被任何文件 import 使用）。等真正接入Supabase时，需要：
1. 在 Supabase 后台创建项目，跑 `supabase/migrations/0001_init.sql` 建表
2. 在部署平台配置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 两个环境变量
3. 新建一个 `src/api/supabaseClient.ts`，用这两个环境变量初始化客户端
4. 把 `src/db/dexie.ts` 里 outbox 队列的消费逻辑接上——目前 outbox 只负责"记录还有什么没同步"，还没有真正往云端推送的代码

## 已知限制（部署前必须让使用者知情）

1. **没有云端备份，没有跨设备同步**：数据只存在用户当前设备的浏览器IndexedDB里。清除浏览器数据、卸载PWA、更换设备都会导致数据永久丢失。目前唯一的"备份"手段是手动导出Excel/JSON（见`docs/user-guide.md`）。
2. **没有登录/权限控制**：任何能打开这个网址、选中一个已有成员身份的人都能以那个身份记账、改动数据。这是为家庭内部低风险场景做的简化，不是安全边界。
3. **同步状态角标只会递增**：因为outbox还没有真正的云端消费者，"N条待同步"这个数字目前只是"有多少条本地写操作发生过"，不会随时间下降。这不是bug，是阶段4明确选择的范围。
4. **只读分享链接尚未实现**：`Trip.publicShareEnabled`/`publicShareToken` 字段和相关UI设计都已就绪，但因为分享链接本质上要求接收方能访问到分享者的数据（需要云端），所以这部分被有意推迟到接入Supabase之后。
5. **iOS Safari 的PWA支持历史上比Android Chrome更受限**（没有`beforeinstallprompt`事件，安装/离线行为也有一些平台差异），部署后建议在真实iPhone上做一次完整验证（安装、离线打开、记账）。
6. **单个JS包体积已经超过500KB**（构建时会有警告，主要是`xlsx`和`leaflet`这两个较大的库）。功能上不影响使用，但如果后续在意首屏加载速度，可以考虑用动态`import()`把导出功能和地图功能按需加载，不在这次范围内处理。

## 故障排查

- **打开就白屏**：先看浏览器控制台报错。这个项目里发生过的一个真实教训：Dexie的表级hook（`src/db/dexie.ts`里的`registerOutboxHooks`）依赖模块顶层变量声明顺序——如果以后改这个文件时把某个常量的声明挪到了`export const db = new TripJournalDB()`之后，会触发"暂时性死区"报错导致整个APP崩溃且没有任何UI提示。改这个文件后务必实际跑一次 `npm run build` + 打开页面验证，不能只看类型检查通过。
- **改了代码但页面显示还是旧的**：Service Worker会缓存应用外壳。开发环境下可以在浏览器devtools的Application/Application面板里手动"Unregister"当前的Service Worker再刷新；生产环境正常情况下`vite-plugin-pwa`的`autoUpdate`策略会自动检测新版本并更新，用户可能需要完全关闭再重新打开一次APP才会生效。
- **地图/地点搜索没反应**：Nominatim是免费公共服务，有请求频率限制，本地开发/测试时如果短时间内触发了限流，稍等一下再试。
