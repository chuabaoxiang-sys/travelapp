// 「使用教程」真实截图生产脚本——不是临时脚本，跟着APP改版要重新跑。
// 用法：node scripts/capture-tutorial-shots.cjs [zh|en]（默认zh），要求本地 `npm run dev` 已经跑在5173端口。
// 每张图存到 public/tutorial-shots/<step-id>[-en].png，红圈坐标用 boundingBox() 量出来，
// 跑完在终端打印一份 JSON，把数值抄进 src/features/tutorials/tutorialsData.ts 的 STEP_RINGS——
// 不是凭肉眼估的。
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const LANG = process.argv[2] === 'en' ? 'en' : 'zh'
const LOCALE = LANG === 'en' ? 'en-US' : 'zh-CN'
const SUFFIX = LANG === 'en' ? '-en' : ''
const OUT = path.resolve(__dirname, '..', 'public', 'tutorial-shots')
const BASE_URL = 'http://localhost:5173'

// 双语文本对照——写在用到的地方旁边，不建一张大表，出错时容易对照上下文核实。
function X(zh, en) {
  return LANG === 'en' ? en : zh
}

const rings = {}
const warnings = []

function round(n) {
  return Math.round(n * 10) / 10
}

async function shot(page, id, ringLocator) {
  const file = path.join(OUT, `${id}${SUFFIX}.png`)
  await page.waitForTimeout(150)
  await page.screenshot({ path: file })
  if (ringLocator) {
    try {
      const box = await ringLocator.boundingBox()
      if (box) {
        const pad = 6
        rings[id] = {
          left: round(((box.x - pad) / 390) * 100),
          top: round(((box.y - pad) / 844) * 100),
          width: round(((box.width + pad * 2) / 390) * 100),
          height: round(((box.height + pad * 2) / 844) * 100),
        }
      } else {
        warnings.push(`${id}: ringLocator resolved but boundingBox() was null`)
      }
    } catch (e) {
      warnings.push(`${id}: failed to compute ring — ${e.message}`)
    }
  }
  console.log('captured', id, rings[id] ? JSON.stringify(rings[id]) : '(no ring)')
}

async function hideDevBanner(page) {
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => {
      if (b.textContent && (b.textContent.includes('本地测试模式') || b.textContent.includes('Local test mode'))) {
        b.style.display = 'none'
      }
    })
  })
}

// 底部导航的4个标签文字（行程/账目/更多……）在概览页的checklist等地方也会
// 原样出现（真实踩过："行程"精确匹配到了概览页一张checklist卡片里的行标题，
// 不是底部导航），必须把查找范围锁在 BottomNav 自己的容器（.nav-blur）里
function navBar(page) {
  return page.locator('.nav-blur')
}
async function clickNavTab(page, label) {
  await navBar(page).getByText(label, { exact: true }).first().click()
  await page.waitForTimeout(500)
}

// 当前最上层的弹层/全屏覆盖层——AddExpensePage/BudgetSheet/TripMoreSheet/ItemForm(sheet模式)
// 都是 BottomSheet 包出来的（根节点 z-30），WishlistScreen/RateBookScreen 是自己的
// absolute inset-0 z-30 全屏页，共用同一个 z-30 类名，用它把查找范围锁在"当前弹层
// 内部"，不会误点到被盖住但仍在DOM里的背景内容（比如行程tab自己的时间线/日历/地图
// 分段控件，跟想去的地点里的列表/地图分段控件是同一套class）
function topSheet(page) {
  return page.locator('div.z-30').last()
}
function topModal(page) {
  return page.locator('div.z-50').last()
}

async function clickCancel(page) {
  await topSheet(page).getByText(X('取消', 'Cancel'), { exact: true }).first().click()
  await page.waitForTimeout(400)
}

// AddExpensePage / ItemForm 共用同一个"其他设置"展开按钮，文案完全一致（含尾部的
// ›），精确文本匹配最稳，不用去猜测周围的summary文字
async function expandOtherSettings(page) {
  await topSheet(page).getByText(X('改 ›', 'More ›'), { exact: true }).first().click()
  await page.waitForTimeout(300)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: LOCALE })
  const page = await context.newPage()

  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByText(/本地测试模式|Local test mode/).first().click()
  await page.waitForTimeout(800)
  await page.getByText('爸爸', { exact: true }).first().click() // 成员名是数据，不跟语言走
  await page.waitForTimeout(1000)
  await hideDevBanner(page)

  // ===================== 快速上手 =====================
  async function backToTripList() {
    const switchBtn = page.getByText(X('切换', 'Switch'), { exact: true }).first()
    if (await switchBtn.isVisible().catch(() => false)) {
      await switchBtn.click()
      await page.waitForTimeout(600)
      await hideDevBanner(page)
    }
  }
  async function openTrip(nameSubstring) {
    await page.getByText(nameSubstring, { exact: false }).first().click()
    await page.waitForTimeout(800)
    await hideDevBanner(page)
  }

  // 三趟种子行程分别对应未出行/出行中/已回来三个阶段（见localTestSeed.ts）——
  // quickstart-1用出行中那趟做"认识底部导航"的通用示范，quickstart-2/3/4
  // 依次是"出发前/途中/回家后"三种phase各自的真实样子
  await openTrip('韩国首尔釜山')
  await shot(page, 'quickstart-1', null) // 已经在行程里、底部导航可见——这一步的重点

  await backToTripList()
  await openTrip('上海7天6夜')
  await shot(page, 'quickstart-2', null)

  await backToTripList()
  await openTrip('韩国首尔釜山')
  await shot(page, 'quickstart-3', null)

  await backToTripList()
  await openTrip('瑞士14天13夜')
  await shot(page, 'quickstart-4', null)

  await backToTripList()
  await shot(page, 'quickstart-5', page.getByText(X('新建行程', 'New trip'), { exact: true }).first())

  // 回到韩国行程做后面大部分截图——出行中阶段数据最完整（有途中账目、多天行程安排）
  await openTrip('韩国首尔釜山')

  // ===================== 行程规划 =====================
  await clickNavTab(page, X('行程', 'Itinerary'))

  const itinerarySegment = page.locator('div.flex.gap-1.bg-segment.rounded-xl.p-1').first()
  await shot(page, 'itinerary-1', itinerarySegment)

  await page.locator('button[title="添加行程项"], button[title="Add item"]').first().click()
  await page.waitForTimeout(600)
  await shot(page, 'itinerary-2', null) // 新增表单整张卡就是重点，不需要额外圈
  await clickCancel(page)

  await shot(page, 'itinerary-3', page.locator('div[role="button"]').first())

  await page.locator('button[title="添加行程项"], button[title="Add item"]').first().click()
  await page.waitForTimeout(600)
  await expandOtherSettings(page)
  const wishlistPickBtn = topSheet(page).getByText(X('从想去的地点里选一个', 'Pick from saved places'), { exact: true }).first()
  await wishlistPickBtn.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(200)
  await shot(page, 'itinerary-4', wishlistPickBtn)
  await clickCancel(page)

  await itinerarySegment.getByText(X('地图', 'Map'), { exact: true }).click()
  await page.waitForTimeout(1200) // MapView 是懒加载的leaflet，给够时间装载
  await shot(page, 'itinerary-5', page.locator('button[title="显示想去的地点"], button[title="Show saved places"]').first())

  await itinerarySegment.getByText(X('时间线', 'Timeline'), { exact: true }).click()
  await page.waitForTimeout(400)
  await shot(page, 'itinerary-6', page.locator('button[title="想去的地点"], button[title="Saved places"]').first())

  // 这一天的标题——种子数据里第一天本来就带了手动标题（"抵达仁川 · 明洞"），
  // 截图重点是标题所在这一整行（含铅笔图标）的位置，不强求展示"自动生成"
  // 那种斜体视觉（生产环境里没写过标题的新行程会自动出现，跟这里的位置一致）
  await shot(page, 'itinerary-7', page.locator('div.font-serif-sc[class*="text-sm"][class*="min-w-0"]').first())

  await page.locator('button[title="编辑标题"], button[title="Edit title"]').first().click()
  await page.waitForTimeout(300)
  await shot(page, 'itinerary-8', page.locator('[class*="border-plan/40"]').first())
  await page.getByText(X('取消', 'Cancel'), { exact: true }).first().click()
  await page.waitForTimeout(300)

  // ===================== 记账与分账 =====================
  await clickNavTab(page, X('账目', 'Ledger'))

  const ledgerSegment = page.locator('div.flex.border.border-line.rounded-xl.overflow-hidden').first()

  await shot(page, 'ledger-settle-1', page.locator('button[title="记一笔"], button[title="Add expense"]').first())

  await page.locator('button[title="记一笔"], button[title="Add expense"]').first().click()
  await page.waitForTimeout(500)
  await shot(page, 'ledger-settle-2', page.locator('div.border-plan').first())

  await shot(page, 'ledger-settle-3', page.locator('div.border-plan').first().locator('div.flex-wrap').first())

  await expandOtherSettings(page)
  await page.waitForTimeout(300)
  {
    // "怎么分"（含"花在几天"）那个带边框的详情盒子——跟下一步要单独圈的"关联行程"
    // 分开，符合任务描述"另外圈付款人/怎么分区域"
    const splitRowText = topSheet(page).getByText(X('怎么分', 'Split'), { exact: true }).first()
    const detailsBox = splitRowText.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
    await shot(page, 'ledger-settle-4', detailsBox)
  }

  {
    // 点开"关联到行程"，选中第一天（当天有3个行程项），让截图里展示出完整的
    // 日期chip+行程项chip，而不是一个还没点开的空提示
    const linkPrompt = topSheet(page).getByText(X('关联到行程里的某天', 'Link to a day or item'), { exact: false }).first()
    await linkPrompt.scrollIntoViewIfNeeded().catch(() => {})
    await linkPrompt.click()
    await page.waitForTimeout(300)
    const linkLabel = topSheet(page).getByText(X('关联行程', 'Link to itinerary'), { exact: true }).first()
    const linkSection = linkLabel.locator('xpath=..')
    // 这个区块第一行是"关联到行程"+"不关联"按钮，日期chip是第二行——直接拿
    // linkSection内第一个button会误点到"不关联"，把刚展开的区块又收起去
    const firstDateChip = linkSection.locator('div.overflow-x-auto button').first()
    await firstDateChip.click().catch(() => {})
    await page.waitForTimeout(300)
    await linkSection.scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, 'ledger-settle-5', linkSection)
  }
  await clickCancel(page)

  await shot(page, 'ledger-settle-6', page.locator('button.text-left.flex.items-center.gap-3.bg-card.rounded-2xl').first())

  await ledgerSegment.getByText(X('结算', 'Settle'), { exact: true }).click()
  await page.waitForTimeout(500)
  // 用getByRole('button')而不是getByText——英文下"Settle up"这个按钮文案
  // 跟SplitTab页面自己的大标题(split.title)英文翻译撞了，getByText会先
  // 匹配到那个不能点的标题div，getByRole把范围收紧到真正的<button>
  await shot(page, 'ledger-settle-7', page.getByRole('button', { name: X('去结算', 'Settle up'), exact: true }).first())

  {
    const byItemHeading = page.getByText(X('按笔结算', 'Settle item by item'), { exact: true }).first()
    const byItemCard = byItemHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
    await byItemCard.scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, 'ledger-settle-8', byItemCard)
  }

  {
    const recordsHeading = page.getByText(X('结算记录', 'Settlement log'), { exact: true }).first()
    await recordsHeading.scrollIntoViewIfNeeded().catch(() => {})
    const addBtn = recordsHeading.locator('xpath=following-sibling::button[1]')
    await shot(page, 'ledger-settle-9', addBtn)
  }

  {
    const balancesHeading = page.getByText(X('谁付了多少', 'Who paid what'), { exact: true }).first()
    await balancesHeading.scrollIntoViewIfNeeded().catch(() => {})
    const balancesList = balancesHeading.locator('xpath=following-sibling::div[1]')
    await shot(page, 'ledger-settle-10', balancesList)
  }

  // 切回"全部"，让预算截图基于原始种子数据，不受后面新增账目影响
  await ledgerSegment.getByText(X('全部', 'All'), { exact: true }).click()
  await page.waitForTimeout(400)

  // ===================== 预算管理 =====================
  // 换到上海（未出行）这趟——种子数据完全没给它设总预算、也没有任何分类预算，
  // 正是budget-1需要的"全新没配置过"空状态。budget-3/4要圈编辑/删除按钮，
  // 但种子数据现在不含任何分类预算了（Korea/瑞士两趟只各有一条总预算），
  // 这里当场设一条总预算+加一条分类预算，才有真实按钮可圈
  await backToTripList()
  await openTrip('上海7天6夜')
  await clickNavTab(page, X('账目', 'Ledger'))

  await page.getByText(X('管理预算', 'Manage budget'), { exact: true }).first().click()
  await page.waitForTimeout(600)

  {
    const overallCard = topSheet(page).locator('div.bg-card.border.border-dashed.border-line.rounded-2xl').first()
    await shot(page, 'budget-1', overallCard)
    await overallCard.locator('input').fill('9000')
    await overallCard.getByRole('button').first().click()
    await page.waitForTimeout(400)
  }

  await shot(page, 'budget-2', topSheet(page).getByText(X('加分类预算', 'Add category budget'), { exact: true }).first())

  await topSheet(page).getByText(X('加分类预算', 'Add category budget'), { exact: true }).first().click()
  await page.waitForTimeout(300)
  await topSheet(page).locator('div.flex-wrap button').first().click() // 随便选第一个可选分类
  await topSheet(page).locator('input[inputmode="decimal"]').first().fill('600')
  // 这个保存按钮是纯图标（Check），没有文字节点，只有title属性，不能用getByText找
  await topSheet(page).locator('button[title="保存"], button[title="Save"]').first().click()
  await page.waitForTimeout(400)

  {
    const editBtn = topSheet(page).locator('button[title="改预算"], button[title="Edit budget"]').first()
    await shot(page, 'budget-3', editBtn)
    const deleteBtn = editBtn.locator('xpath=following-sibling::button[1]')
    await shot(page, 'budget-4', deleteBtn)
  }

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // ===================== 想去的地点 =====================
  await clickNavTab(page, X('行程', 'Itinerary'))
  await page.locator('button[title="想去的地点"], button[title="Saved places"]').first().click()
  await page.waitForTimeout(500)

  await shot(page, 'wishlist-1', topSheet(page).locator('button[title="新增"], button[title="Add"]').first())

  await topSheet(page).locator('button[title="新增"], button[title="Add"]').first().click()
  await page.waitForTimeout(500)
  const wishlistModal = topModal(page)
  const linkInput = wishlistModal.locator('input').nth(1)
  await shot(page, 'wishlist-2', linkInput)

  // 填地点名字——试着搜一个真实地标，搜到就点第一条拿到坐标，搜不到（离线/被限流）
  // 就留纯文字，地图那一步就不会有图钉，属于已知的降级
  const locationInput = wishlistModal.locator('input').nth(0)
  await locationInput.fill('Tokyo Tower')
  await page.waitForTimeout(1600)
  let gotPin = false
  const firstSuggestion = wishlistModal.locator('div.absolute.z-40 button').first()
  if (await firstSuggestion.isVisible().catch(() => false)) {
    await firstSuggestion.click()
    gotPin = true
    await page.waitForTimeout(300)
  }
  await linkInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  // 这个保存按钮是纯图标（Check），没有文字节点，只有title属性，不能用getByText找
  await topModal(page).locator('button[title="保存"], button[title="Save"]').first().click()
  await page.waitForTimeout(2200) // /api/resolve-link-preview 在纯vite dev下会404，等它降级完
  if (!gotPin) warnings.push('wishlist: Tokyo Tower 搜索没有返回建议列表，新地点没有坐标，地图视图可能看不到图钉')

  {
    const placeCard = topSheet(page).locator('div.bg-card.border.border-line.rounded-2xl.p-3').first()
    await shot(page, 'wishlist-3', placeCard)
  }
  await shot(page, 'wishlist-4', topSheet(page).getByText(X('还没去', 'Not yet'), { exact: true }).first())

  {
    const wishlistSegment = topSheet(page).locator('div.flex.gap-1.bg-segment.rounded-xl.p-1').first()
    await wishlistSegment.getByText(X('地图', 'Map'), { exact: true }).click()
  }
  await page.waitForTimeout(1200)
  await shot(page, 'wishlist-5', null)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // ===================== 汇率簿 =====================
  // 换回韩国行程——汇率簿这几步依赖的KRW汇率记录、已经用了汇率簿的KRW途中
  // 账目，都是种在韩国这趟行程上的，上海那趟没有任何外币数据
  await backToTripList()
  await openTrip('韩国首尔釜山')
  await clickNavTab(page, X('账目', 'Ledger'))
  await page.locator('button[title="汇率簿"], button[title="Rate book"]').first().click()
  await page.waitForTimeout(500)

  await shot(page, 'rates-1', topSheet(page).locator('button[title="新增"], button[title="Add"]').first())
  {
    // KRW这个货币对种子数据里正好有2条——圈第一条示范"同一货币对能记多条"
    const firstEntry = topSheet(page).locator('div.bg-card.border.border-line.rounded-2xl.p-3').first()
    await shot(page, 'rates-2', firstEntry)
  }

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 打开记一笔，选外币KRW（韩国行程的目的地货币，直接是个快捷chip，不用走
  // "其他"手动输入），展示汇率选择区——种子数据里KRW已经有2条汇率、也已经有
  // 好几笔途中账目在用这条汇率簿条目，"这趟换汇换得怎么样"卡片本来就有数据，
  // 这里顺手再真实存一笔，单纯是为了截到"选汇率"那个交互瞬间
  await page.locator('button[title="记一笔"], button[title="Add expense"]').first().click()
  await page.waitForTimeout(500)
  const amountInput = page.locator('div.border-plan input').first()
  await amountInput.fill('30000')
  await page.locator('div.border-plan').first().getByText('KRW', { exact: true }).first().click()
  await page.waitForTimeout(600)
  {
    const rateChip = topSheet(page).getByText('出发前网上换的现金', { exact: false }).first() // 汇率标签是数据，不跟语言走
    const chipRow = rateChip.locator('xpath=ancestor::div[contains(@class,"flex-wrap")][1]')
    const rateArea = chipRow.locator('xpath=..')
    await shot(page, 'rates-3', rateArea)
    await rateChip.click()
  }
  await page.waitForTimeout(200)
  {
    const catLabel = topSheet(page).getByText(X('分类', 'Category'), { exact: true }).first()
    const catRow = catLabel.locator('xpath=following-sibling::div[1]')
    await catRow.locator('button').first().click()
  }
  await page.waitForTimeout(200)
  await topSheet(page).getByText(X('保存', 'Save'), { exact: true }).first().click()
  await page.waitForTimeout(1200)

  await page.locator('button[title="汇率簿"], button[title="Rate book"]').first().click()
  await page.waitForTimeout(600)
  {
    const summaryHeading = topSheet(page).getByText(X('这趟换汇换得怎么样', 'How your exchanges went'), { exact: true }).first()
    if (await summaryHeading.isVisible().catch(() => false)) {
      const summaryCard = summaryHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
      await shot(page, 'rates-4', summaryCard)
    } else {
      warnings.push('rates-4: 综合汇率卡片没有出现（可能新增的JPY账目没有成功用上汇率簿条目），改截当前汇率簿顶部替代')
      await shot(page, 'rates-4', null)
    }
  }

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // ===================== 设置与数据 =====================
  await clickNavTab(page, X('更多', 'More'))

  {
    const darkModeLabel = topSheet(page).getByText(X('深色模式', 'Dark mode'), { exact: true }).first()
    const darkModeControl = darkModeLabel.locator('xpath=following-sibling::div[1]')
    await shot(page, 'settings-1', darkModeControl)
  }
  {
    const langLabel = topSheet(page).getByText(X('语言', 'Language'), { exact: true }).first()
    const langControl = langLabel.locator('xpath=following-sibling::div[1]')
    await shot(page, 'settings-2', langControl)
  }
  {
    const exportLabel = topSheet(page).getByText(X('导出行程', 'Export trip'), { exact: true }).first()
    const exportRow = exportLabel.locator('xpath=../..')
    await shot(page, 'settings-3', exportRow)
  }
  {
    const shareLabel = topSheet(page).getByText(X('分享设置', 'Share settings'), { exact: true }).first()
    const shareRow = shareLabel.locator('xpath=ancestor::button[1]')
    await shot(page, 'settings-4', shareRow)
  }
  {
    const syncLabel = topSheet(page).getByText(X('同步详情', 'Sync details'), { exact: true }).first()
    const syncRow = syncLabel.locator('xpath=ancestor::button[1]')
    await shot(page, 'settings-5', syncRow)
  }

  // ===================== 行程额度 =====================
  // 本地测试模式下 recordTripCreation() 直接短路跳过限额检查（domain/billing.ts），
  // 所以"建第2趟被拦下"和"已解锁"这两个状态没法在这个脚本里真实触发——只截
  // "更多"里的入口和面板本身未解锁时的说明+按钮，跟其他教程分类里同样浅的
  // settings-* 步骤是同一个深度
  {
    const subLabel = topSheet(page).getByText(X('行程额度', 'Trip Limit'), { exact: true }).first()
    const subRow = subLabel.locator('xpath=ancestor::button[1]')
    await shot(page, 'trip-limit-1', subRow)

    await subRow.click()
    await page.waitForTimeout(500)
    const unlockBtn = topSheet(page).getByText(X('解锁更多行程', 'Unlock More Trips'), { exact: false }).first()
    await shot(page, 'trip-limit-2', unlockBtn)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }

  await browser.close()

  console.log('\n===== RINGS JSON (' + LANG + ') =====')
  console.log(JSON.stringify(rings, null, 2))
  if (warnings.length) {
    console.log('\n===== WARNINGS (' + LANG + ') =====')
    warnings.forEach((w) => console.log('- ' + w))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
