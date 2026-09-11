// 宣传素材截图生产脚本——跟 scripts/capture-tutorial-shots.cjs 是同一套思路
// （本地测试模式 + src/dev/localTestSeed.ts 的三趟种子行程：上海/未出行、
// 韩国/出行中、瑞士/已回来），区别是这里存的是整页大图（给宣传用），不是
// 教程里那种带红圈坐标的局部裁剪图。
//
// 用法：node marketing-assets/scripts/capture-marketing-shots.cjs [light|dark]（默认light）
// 要求本地 `npm run dev` 已经跑在5173端口。
// 每张图存到 marketing-assets/screenshots/<分类目录>/<文件名>[-dark].png
//
// 每一步都包了try/catch——单个选择器失效不该拖垮整个批次，跑完在终端打印
// 一份成功/失败清单，失败的自己再手动补。
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const THEME = process.argv[2] === 'dark' ? 'dark' : 'light'
const SUFFIX = THEME === 'dark' ? '-dark' : ''
const ROOT = path.resolve(__dirname, '..', 'screenshots')
const BASE_URL = 'http://localhost:5173'

const done = []
const failed = []

function navBar(page) {
  return page.locator('.nav-blur')
}
async function clickNavTab(page, label) {
  await navBar(page).getByText(label, { exact: true }).first().click()
  await page.waitForTimeout(500)
}
function topSheet(page) {
  return page.locator('div.z-30').last()
}
async function hideDevBanner(page) {
  // 只匹配"点击退出"——登录页上"本地测试模式（跳过登录…）"那颗入口按钮文案里
  // 同样含有"本地测试模式"几个字，用短的那个子串匹配会把登录页自己的按钮也
  // 藏起来，后面就点不到了（真实翻车过）
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => {
      if (b.textContent && b.textContent.includes('点击退出')) b.style.display = 'none'
    })
  })
}
async function backToTripList(page) {
  const switchBtn = page.getByText('切换', { exact: true }).first()
  if (await switchBtn.isVisible().catch(() => false)) {
    await switchBtn.click()
    await page.waitForTimeout(600)
    await hideDevBanner(page)
  }
}
async function openTrip(page, nameSubstring) {
  await page.getByText(nameSubstring, { exact: false }).first().click()
  await page.waitForTimeout(800)
  await hideDevBanner(page)
}

// folder: 对应 marketing-assets/screenshots/ 下的分类目录名；name: 不带后缀的文件名
async function shot(page, folder, name) {
  const dir = path.join(ROOT, folder)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}${SUFFIX}.png`)
  try {
    await page.waitForTimeout(200)
    // 每次真正落笔前都重新隐藏一遍——这个悬浮按钮是React组件，导航/切tab
    // 都会让它重新渲染出一个新DOM节点，之前调用hideDevBanner()隐藏的是
    // 旧节点，不会持续生效（真实翻车过：好几张成品图右下角都带着它）
    await hideDevBanner(page)
    await page.screenshot({ path: file })
    done.push(`${folder}/${name}${SUFFIX}.png`)
    console.log('OK  ', `${folder}/${name}${SUFFIX}.png`)
  } catch (e) {
    failed.push(`${folder}/${name}${SUFFIX}.png — ${e.message}`)
    console.log('FAIL', `${folder}/${name}${SUFFIX}.png —`, e.message)
  }
}

// 单个动作失败不该拦住后面所有截图——包一层，记警告继续跑
async function tryStep(label, fn) {
  try {
    await fn()
  } catch (e) {
    failed.push(`[step] ${label} — ${e.message}`)
    console.log('STEP-FAIL', label, '—', e.message)
  }
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    locale: 'zh-CN',
  })
  // 在任何页面脚本跑之前就把主题写进localStorage，index.html里的内联脚本
  // 会在首次绘制前读到它，深色截图不会先闪一下浅色
  await context.addInitScript((theme) => {
    if (theme === 'dark') localStorage.setItem('trip-journal:theme', 'dark')
  }, THEME)
  const page = await context.newPage()

  // ===================== 登录页（本地测试模式按钮点下去之前）=====================
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await shot(page, '01-引导注册', '登录页-邮箱输入')

  await page.getByText('本地测试模式').first().click()
  await page.waitForTimeout(800)
  await shot(page, '01-引导注册', '选择成员')

  await page.getByText('爸爸', { exact: true }).first().click()
  await page.waitForTimeout(1000)
  await hideDevBanner(page)

  // ===================== 我的行程 列表 =====================
  await tryStep('我的行程列表', async () => {
    await backToTripList(page)
    await shot(page, '02-总览', '我的行程-三趟行程列表')
  })

  // ===================== 上海（未出行）=====================
  await tryStep('上海-概览+行程+预算', async () => {
    await openTrip(page, '上海')
    await shot(page, '02-总览', '概览-出发前阶段')
    await clickNavTab(page, '行程')
    await shot(page, '03-行程', '时间线-上海未出行')
    await clickNavTab(page, '账目')
    await shot(page, '04-记一笔', '账目列表-仅出发前花费')
    await page.getByText('管理预算', { exact: true }).first().click()
    await page.waitForTimeout(600)
    await shot(page, '05-预算', '预算面板-未设置')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  // ===================== 韩国（出行中，数据最完整）=====================
  await tryStep('韩国-总览', async () => {
    await backToTripList(page)
    await openTrip(page, '韩国')
    await shot(page, '02-总览', '概览-出行中阶段')
  })

  await tryStep('韩国-行程三视图', async () => {
    await clickNavTab(page, '行程')
    const segment = page.locator('div.flex.gap-1.bg-segment.rounded-xl.p-1').first()
    await shot(page, '03-行程', '时间线-韩国出行中')
    await segment.getByText('日历', { exact: true }).click()
    await page.waitForTimeout(400)
    await shot(page, '03-行程', '日历视图')
    await segment.getByText('地图', { exact: true }).click()
    await page.waitForTimeout(1200)
    await shot(page, '03-行程', '地图视图')
    await segment.getByText('时间线', { exact: true }).click()
    await page.waitForTimeout(400)
  })

  await tryStep('韩国-新增行程项表单', async () => {
    await page.locator('button[title="添加行程项"]').first().click()
    await page.waitForTimeout(600)
    await shot(page, '03-行程', '新增行程项表单')
    await topSheet(page).getByText('取消', { exact: true }).first().click()
    await page.waitForTimeout(400)
  })

  await tryStep('韩国-想去的地点', async () => {
    await page.locator('button[title="想去的地点"]').first().click()
    await page.waitForTimeout(600)
    await shot(page, '10-心愿单', '想去的地点-列表')
    const wl = topSheet(page).locator('div.flex.gap-1.bg-segment.rounded-xl.p-1').first()
    if (await wl.isVisible().catch(() => false)) {
      await wl.getByText('地图', { exact: true }).click()
      await page.waitForTimeout(1200)
      await shot(page, '10-心愿单', '想去的地点-地图')
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  })

  await tryStep('韩国-记一笔', async () => {
    await clickNavTab(page, '账目')
    await shot(page, '04-记一笔', '账目列表-出行中')
    await page.locator('button[title="记一笔"]').first().click()
    await page.waitForTimeout(500)
    await shot(page, '04-记一笔', '新增账目-空表单')
    const amountInput = page.locator('div.border-plan input').first()
    await amountInput.fill('45000')
    await page.locator('div.border-plan').first().getByText('KRW', { exact: true }).first().click()
    await page.waitForTimeout(600)
    await shot(page, '04-记一笔', '新增账目-外币选汇率')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  })

  await tryStep('韩国-预算', async () => {
    await page.getByText('管理预算', { exact: true }).first().click()
    await page.waitForTimeout(600)
    await shot(page, '05-预算', '预算面板-已设置')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  })

  await tryStep('韩国-结算', async () => {
    const ledgerSegment = page.locator('div.flex.border.border-line.rounded-xl.overflow-hidden').first()
    await ledgerSegment.getByText('结算', { exact: true }).click()
    await page.waitForTimeout(600)
    await shot(page, '06-拆分收付', '结算总览')
    const byItemHeading = page.getByText('按笔结算', { exact: true }).first()
    if (await byItemHeading.isVisible().catch(() => false)) {
      await byItemHeading.scrollIntoViewIfNeeded()
      await shot(page, '06-拆分收付', '按笔结算')
    }
    await ledgerSegment.getByText('全部', { exact: true }).click()
    await page.waitForTimeout(400)
  })

  await tryStep('韩国-汇率簿', async () => {
    await page.locator('button[title="汇率簿"]').first().click()
    await page.waitForTimeout(600)
    await shot(page, '07-汇率转换', '汇率簿-列表')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  })

  // ===================== 瑞士（已回来）=====================
  await tryStep('瑞士-总览+结算', async () => {
    await backToTripList(page)
    await openTrip(page, '瑞士')
    await shot(page, '02-总览', '概览-已结束阶段')
    await clickNavTab(page, '账目')
    const ledgerSegment = page.locator('div.flex.border.border-line.rounded-xl.overflow-hidden').first()
    await ledgerSegment.getByText('结算', { exact: true }).click()
    await page.waitForTimeout(600)
    await shot(page, '06-拆分收付', '结算总览-已回来')
  })

  // ===================== 更多 / 设置 =====================
  await tryStep('更多面板', async () => {
    await clickNavTab(page, '更多')
    await shot(page, '16-更多设置', '更多面板')
  })

  await tryStep('分享设置', async () => {
    await topSheet(page).getByText('分享设置', { exact: true }).first().click()
    await page.waitForTimeout(600)
    await shot(page, '13-分享', '分享设置面板')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  })

  await tryStep('反馈入口', async () => {
    // 上一步"分享设置"点Escape会把父级"更多"面板一起关掉（同一个sheet栈），
    // 不是只关子面板——重新点一次"更多"tab，别假设面板还开着
    await clickNavTab(page, '更多')
    const fb = topSheet(page).getByText('提交反馈', { exact: true }).first()
    await fb.scrollIntoViewIfNeeded().catch(() => {})
    if (await fb.isVisible().catch(() => false)) {
      await fb.click()
      await page.waitForTimeout(600)
      await shot(page, '14-反馈', '反馈表单')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    } else {
      failed.push('[step] 反馈入口 — 在更多面板里没找到"反馈"文字，跳过')
    }
  })

  await browser.close()

  console.log(`\n===== 完成 ${done.length} 张，失败/跳过 ${failed.length} 项（主题：${THEME}）=====`)
  if (failed.length) {
    console.log('失败/跳过清单：')
    failed.forEach((f) => console.log('- ' + f))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
