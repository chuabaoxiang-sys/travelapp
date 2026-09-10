// 本地 Dexie 用 camelCase 字段名，远端 Postgres 用 snake_case，而且有几处
// 字段名/取值/结构上的真实差异（不只是大小写），这里逐表写清楚映射关系，
// 不用通用的自动转换——那样反而会掩盖这些真实的不一致，出问题也更难查。

function iso(ms: number) {
  return new Date(ms).toISOString()
}
function ms(iso: string) {
  return new Date(iso).getTime()
}
// Postgres 的 numeric 类型经 PostgREST 返回时是字符串，不转成 number 会把字符串存进本地
function num(v: unknown): number {
  return typeof v === 'number' ? v : parseFloat(String(v))
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v)
}
// 软删除时间戳——本地是毫秒数或null，远端是timestamptz或null，跟createdAt/
// updatedAt用同一套iso()/ms()转换，只是要额外处理null（没删=null，两边都是）
function isoOrNull(msValue: number | null | undefined): string | null {
  return msValue === null || msValue === undefined ? null : iso(msValue)
}
function msOrNull(isoValue: unknown): number | null {
  return isoValue === null || isoValue === undefined ? null : ms(String(isoValue))
}

export interface TableSyncConfig {
  remoteTable: string
  // upsert/查询时用哪个（组）字段判断"是同一行"——大多数表是 'id'，
  // trip_member 是复合键（远端没有单独的 id 列）
  conflictColumns: string
  toRemote: (local: any) => Record<string, unknown>
  fromRemote: (remote: any) => any
  // 本地记录是否有 updatedAt 字段可比较——没有的表（members/expenseSplits/tripMembers）
  // 拉取时直接覆盖，不做"谁更新"的比较
  hasUpdatedAt: boolean
}

export const SYNC_CONFIG: Record<string, TableSyncConfig> = {
  trips: {
    remoteTable: 'trip',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (t) => ({
      id: t.id,
      household_id: t.householdId,
      name: t.name,
      home_currency: t.homeCurrency,
      start_date: t.startDate,
      end_date: t.endDate,
      status: t.status === 'active' ? 'ongoing' : t.status,
      public_share_scope: t.publicShareScope,
      public_share_token: t.publicShareToken,
      public_share_template: t.publicShareTemplate,
      destination_countries: t.destinationCountries ?? null,
      currencies: t.currencies ?? null,
      deleted_at: isoOrNull(t.deletedAt),
      created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      name: r.name,
      homeCurrency: r.home_currency,
      startDate: r.start_date,
      endDate: r.end_date,
      status: r.status === 'ongoing' ? 'active' : r.status,
      publicShareScope: r.public_share_scope,
      publicShareToken: r.public_share_token,
      publicShareTemplate: r.public_share_template,
      destinationCountries: r.destination_countries ?? undefined,
      currencies: r.currencies ?? undefined,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  members: {
    remoteTable: 'member',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (m) => ({
      id: m.id,
      household_id: m.householdId,
      display_name: m.displayName,
      color_tag: m.colorTag,
      is_active: m.isActive,
      preferred_locale: m.preferredLocale ?? null,
      created_at: iso(m.createdAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      displayName: r.display_name,
      colorTag: r.color_tag,
      isActive: r.is_active,
      preferredLocale: r.preferred_locale ?? null,
      createdAt: ms(r.created_at),
    }),
  },

  // trip_member 目前应用里没有任何地方真正写入过（只在级联删除时清过），
  // 保留映射只是为了 SYNCED_TABLES 循环不报错，实际不会有数据
  tripMembers: {
    remoteTable: 'trip_member',
    conflictColumns: 'trip_id,member_id',
    hasUpdatedAt: false,
    toRemote: (tm) => ({ trip_id: tm.tripId, member_id: tm.memberId, deleted_at: isoOrNull(tm.deletedAt) }),
    fromRemote: (r) => ({ id: `${r.trip_id}:${r.member_id}`, tripId: r.trip_id, memberId: r.member_id, deletedAt: msOrNull(r.deleted_at) }),
  },

  itineraryDays: {
    remoteTable: 'itinerary_day',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (d) => ({
      id: d.id,
      household_id: d.householdId,
      trip_id: d.tripId,
      day_date: d.date,
      title: d.title,
      notes: d.notes,
      deleted_at: isoOrNull(d.deletedAt),
      created_at: iso(d.createdAt),
      updated_at: iso(d.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      date: r.day_date,
      title: r.title,
      notes: r.notes,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  // itinerary_item 远端没有 trip_id 列（要经 day_id 查 itinerary_day 才能得到）。
  // 拉取时的 tripId 由调用方（sync.ts）用本地已有的 day->trip 映射表补上
  itineraryItems: {
    remoteTable: 'itinerary_item',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (it) => ({
      id: it.id,
      household_id: it.householdId,
      day_id: it.dayId,
      sort_order: it.orderIndex,
      start_time: it.time,
      title: it.title,
      location_name: it.locationName,
      lat: it.lat,
      lng: it.lng,
      notes: it.notes,
      booking_status: it.bookingStatus ?? null,
      booking_deadline: it.bookingDeadline ?? null,
      created_by: it.createdBy ?? null,
      source_wishlist_id: it.sourceWishlistId ?? null,
      deleted_at: isoOrNull(it.deletedAt),
      created_at: iso(it.createdAt),
      updated_at: iso(it.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      dayId: r.day_id,
      tripId: '', // 由 sync.ts 用 day_id -> trip_id 的映射表补上，这里先占位
      orderIndex: r.sort_order,
      // Postgres time 列经 PostgREST 返回时带秒（HH:MM:SS），本地只用 HH:MM，截断存
      time: r.start_time ? String(r.start_time).slice(0, 5) : null,
      title: r.title,
      locationName: r.location_name,
      lat: r.lat === null ? null : num(r.lat),
      lng: r.lng === null ? null : num(r.lng),
      notes: r.notes,
      bookingStatus: r.booking_status ?? null,
      bookingDeadline: r.booking_deadline ?? null,
      createdBy: r.created_by ?? null,
      sourceWishlistId: r.source_wishlist_id ?? null,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  rateBookEntries: {
    remoteTable: 'rate_book_entry',
    conflictColumns: 'id',
    hasUpdatedAt: false, // 本地类型没有 updatedAt 字段
    toRemote: (e) => ({
      id: e.id,
      household_id: e.householdId,
      trip_id: e.tripId,
      currency_code: e.foreignCurrency,
      label: e.label,
      rate: e.rate,
      source: e.source,
      created_by: e.createdBy,
      last_used_at: e.lastUsedAt ? iso(e.lastUsedAt) : null,
      // 本地只存布尔值，没有归档时间点；归档瞬间就用当下时间戳，足够满足
      // "是否还出现在推荐列表"这个用途，不需要精确到哪一刻归档的
      archived_at: e.archived ? iso(Date.now()) : null,
      created_at: iso(e.createdAt),
      exchanged_home_amount: e.exchangedHomeAmount ?? null,
      exchanged_foreign_amount: e.exchangedForeignAmount ?? null,
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      foreignCurrency: r.currency_code,
      label: r.label,
      rate: num(r.rate),
      source: r.source,
      createdBy: r.created_by,
      lastUsedAt: r.last_used_at ? ms(r.last_used_at) : 0,
      archived: r.archived_at !== null,
      createdAt: ms(r.created_at),
      exchangedHomeAmount: numOrNull(r.exchanged_home_amount),
      exchangedForeignAmount: numOrNull(r.exchanged_foreign_amount),
    }),
  },

  expenses: {
    remoteTable: 'expense',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (e) => ({
      id: e.id,
      household_id: e.householdId,
      trip_id: e.tripId,
      category_id: e.categoryId,
      expense_date: e.expenseDate,
      phase: e.phase,
      expense_currency: e.expenseCurrency,
      expense_amount: e.expenseAmount,
      rate_book_entry_id: e.rateBookEntryId,
      rate_used: e.rateUsed,
      home_amount: e.homeAmount,
      paid_by: e.paidBy,
      recorded_by: e.recordedBy,
      split_type: e.splitType,
      day_spread_mode: e.daySpreadMode ?? null,
      rate_spread: e.rateSpread ?? null,
      itinerary_day_id: e.itineraryDayId,
      itinerary_item_id: e.itineraryItemId,
      // 本地字段叫 description，远端表这一列叫 notes——纯粹是命名不统一，不是语义差异
      notes: e.description,
      deleted_at: isoOrNull(e.deletedAt),
      created_at: iso(e.createdAt),
      updated_at: iso(e.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      categoryId: r.category_id,
      expenseDate: r.expense_date,
      phase: r.phase,
      expenseCurrency: r.expense_currency,
      expenseAmount: num(r.expense_amount),
      rateBookEntryId: r.rate_book_entry_id,
      rateUsed: numOrNull(r.rate_used),
      homeAmount: num(r.home_amount),
      paidBy: r.paid_by,
      recordedBy: r.recorded_by,
      splitType: r.split_type,
      daySpreadMode: r.day_spread_mode ?? null,
      rateSpread: r.rate_spread ?? null,
      itineraryDayId: r.itinerary_day_id,
      itineraryItemId: r.itinerary_item_id,
      description: r.notes,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  // 这张表的deleted_at映射对pullAll()有效（别的设备/软删的行拉下来时能带上
  // 这个标记），但对推送无效——expenseSplits不走下面这份toRemote去push，
  // pushOutbox对这张表整个是特殊处理：按expenseId分组，调replace_expense_splits
  // RPC整批原子替换（见sync.ts），那个RPC目前不接收/不写deleted_at这一列。
  // 这不构成实际问题：domain/splits.ts等所有读取分摊数据的地方，判断"这笔账
  // 还算不算数"看的都是它挂靠的expense自己的deletedAt（expenseIds先排掉软删
  // 的账目，splits天然跟着排掉），没有任何地方单独依赖expenseSplits.deletedAt
  // 这个字段做判断——真要补全，需要连着改这个RPC，成本换不来实际收益，先不做
  expenseSplits: {
    remoteTable: 'expense_split',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (s) => ({
      id: s.id,
      household_id: s.householdId,
      expense_id: s.expenseId,
      member_id: s.memberId,
      share_amount: s.shareAmount,
      deleted_at: isoOrNull(s.deletedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      expenseId: r.expense_id,
      memberId: r.member_id,
      shareAmount: num(r.share_amount),
      deletedAt: msOrNull(r.deleted_at),
    }),
  },

  expenseDayAllocations: {
    remoteTable: 'expense_day_allocation',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (a) => ({
      id: a.id,
      household_id: a.householdId,
      expense_id: a.expenseId,
      trip_id: a.tripId,
      day_date: a.date,
      amount: a.amount,
      deleted_at: isoOrNull(a.deletedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      expenseId: r.expense_id,
      tripId: r.trip_id,
      date: r.day_date,
      amount: num(r.amount),
      deletedAt: msOrNull(r.deleted_at),
    }),
  },

  expenseRateAllocations: {
    remoteTable: 'expense_rate_allocation',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (a) => ({
      id: a.id,
      household_id: a.householdId,
      expense_id: a.expenseId,
      trip_id: a.tripId,
      rate_book_entry_id: a.rateBookEntryId,
      foreign_amount: a.foreignAmount,
      rate_used: a.rateUsed,
      home_amount: a.homeAmount,
      deleted_at: isoOrNull(a.deletedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      expenseId: r.expense_id,
      tripId: r.trip_id,
      rateBookEntryId: r.rate_book_entry_id,
      foreignAmount: num(r.foreign_amount),
      rateUsed: num(r.rate_used),
      homeAmount: num(r.home_amount),
      deletedAt: msOrNull(r.deleted_at),
    }),
  },

  budgets: {
    remoteTable: 'budget',
    conflictColumns: 'id',
    hasUpdatedAt: false, // 本地类型没有 updatedAt 字段
    toRemote: (b) => ({
      id: b.id,
      household_id: b.householdId,
      trip_id: b.tripId,
      category_id: b.categoryId,
      amount: b.amount,
      alert_threshold_pct: b.alertThresholdPct,
      deleted_at: isoOrNull(b.deletedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      categoryId: r.category_id,
      // 远端 budget 表目前没有 phase 列（应用里也没有真正用到按阶段分预算的功能）
      phase: null,
      amount: num(r.amount),
      alertThresholdPct: num(r.alert_threshold_pct),
      deletedAt: msOrNull(r.deleted_at),
    }),
  },

  settlements: {
    remoteTable: 'settlement',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (s) => ({
      id: s.id,
      household_id: s.householdId,
      trip_id: s.tripId,
      from_member_id: s.fromMemberId,
      to_member_id: s.toMemberId,
      amount: s.amount,
      settled_date: s.settledDate,
      note: s.note,
      created_by: s.createdBy ?? null,
      expense_id: s.expenseId ?? null,
      is_prepayment: s.isPrepayment ?? false,
      deleted_at: isoOrNull(s.deletedAt),
      created_at: iso(s.createdAt),
      updated_at: iso(s.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      fromMemberId: r.from_member_id,
      toMemberId: r.to_member_id,
      amount: num(r.amount),
      settledDate: r.settled_date,
      note: r.note,
      createdBy: r.created_by ?? null,
      expenseId: r.expense_id ?? null,
      isPrepayment: r.is_prepayment ?? false,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  feedback: {
    remoteTable: 'feedback',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (f) => ({
      id: f.id,
      household_id: f.householdId,
      trip_id: f.tripId,
      submitted_by: f.submittedBy,
      category: f.category,
      content: f.content,
      app_version: f.appVersion,
      created_at: iso(f.createdAt),
      updated_at: iso(f.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      submittedBy: r.submitted_by,
      category: r.category,
      content: r.content,
      appVersion: r.app_version ?? null,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  wishlistPlaces: {
    remoteTable: 'wishlist_place',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (w) => ({
      id: w.id,
      household_id: w.householdId,
      name: w.name,
      lat: w.lat,
      lng: w.lng,
      notes: w.notes,
      visited: w.visited,
      created_by: w.createdBy ?? null,
      created_at: iso(w.createdAt),
      updated_at: iso(w.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      name: r.name,
      lat: r.lat === null ? null : num(r.lat),
      lng: r.lng === null ? null : num(r.lng),
      notes: r.notes,
      visited: r.visited,
      createdBy: r.created_by ?? null,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },
  // 2026-09-10修复：这张表和下面三张（expenseSatisfactions/expenseLineItems/
  // expenseLineItemMembers）之前一直没有出现在这份配置里——本地会正常记进
  // outbox（在SYNCED_TABLES里），但pushOutbox查不到配置，直接把这类未知表名
  // 的outbox条目标记成"已同步"跳过，实际从来没有真的推上云端；pullAll同理
  // 也没拉过。云端表（0029/0031迁移）结构一直是齐的，纯粹是这份映射漏掉了
  // 四张新表，不是设计如此。见docs/功能路线图 相关记录和2026-09-10的讨论。
  //
  // rating为null（翻卡片"跳过"）的行正常同步——0030迁移已经把day_satisfaction
  // .rating改成允许null，跳过状态本身也值得跨设备一致（同一个人用手机+
  // 平板各翻一半，跳过的那天不该在另一台设备上还显示"待翻"）
  daySatisfactions: {
    remoteTable: 'day_satisfaction',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (s) => ({
      id: s.id,
      household_id: s.householdId,
      trip_id: s.tripId,
      day_id: s.dayId,
      member_id: s.memberId,
      rating: s.rating,
      deleted_at: isoOrNull(s.deletedAt),
      created_at: iso(s.createdAt),
      updated_at: iso(s.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      dayId: r.day_id,
      memberId: r.member_id,
      rating: r.rating,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  expenseSatisfactions: {
    remoteTable: 'expense_satisfaction',
    conflictColumns: 'id',
    hasUpdatedAt: true,
    toRemote: (s) => ({
      id: s.id,
      household_id: s.householdId,
      trip_id: s.tripId,
      expense_id: s.expenseId,
      member_id: s.memberId,
      rating: s.rating,
      deleted_at: isoOrNull(s.deletedAt),
      created_at: iso(s.createdAt),
      updated_at: iso(s.updatedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      tripId: r.trip_id,
      expenseId: r.expense_id,
      memberId: r.member_id,
      rating: r.rating,
      deletedAt: msOrNull(r.deleted_at),
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

  // 没有updatedAt：逐项拆账的子项/成员关联永远整份替换（改一笔就是删旧的
  // 重新写一份新的），不支持编辑单个字段，见migration 0031的说明
  expenseLineItems: {
    remoteTable: 'expense_line_item',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (i) => ({
      id: i.id,
      household_id: i.householdId,
      expense_id: i.expenseId,
      name: i.name,
      amount: i.amount,
      order_index: i.orderIndex,
      deleted_at: isoOrNull(i.deletedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      expenseId: r.expense_id,
      name: r.name,
      amount: num(r.amount),
      orderIndex: r.order_index,
      deletedAt: msOrNull(r.deleted_at),
    }),
  },

  expenseLineItemMembers: {
    remoteTable: 'expense_line_item_member',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (m) => ({
      id: m.id,
      household_id: m.householdId,
      line_item_id: m.lineItemId,
      member_id: m.memberId,
      deleted_at: isoOrNull(m.deletedAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      lineItemId: r.line_item_id,
      memberId: r.member_id,
      deletedAt: msOrNull(r.deleted_at),
    }),
  },

  // 没有updatedAt：链接只有增/删，不支持编辑，见migration 0027的说明
  wishlistPlaceLinks: {
    remoteTable: 'wishlist_place_link',
    conflictColumns: 'id',
    hasUpdatedAt: false,
    toRemote: (l) => ({
      id: l.id,
      wishlist_place_id: l.wishlistPlaceId,
      household_id: l.householdId,
      url: l.url,
      platform: l.platform,
      title: l.title,
      thumbnail_url: l.thumbnailUrl,
      created_by: l.createdBy ?? null,
      created_at: iso(l.createdAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      wishlistPlaceId: r.wishlist_place_id,
      householdId: r.household_id,
      url: r.url,
      platform: r.platform,
      title: r.title,
      thumbnailUrl: r.thumbnail_url,
      createdBy: r.created_by ?? null,
      createdAt: ms(r.created_at),
    }),
  },
}
