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
      created_at: iso(m.createdAt),
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      displayName: r.display_name,
      colorTag: r.color_tag,
      isActive: r.is_active,
      createdAt: ms(r.created_at),
    }),
  },

  // trip_member 目前应用里没有任何地方真正写入过（只在级联删除时清过），
  // 保留映射只是为了 SYNCED_TABLES 循环不报错，实际不会有数据
  tripMembers: {
    remoteTable: 'trip_member',
    conflictColumns: 'trip_id,member_id',
    hasUpdatedAt: false,
    toRemote: (tm) => ({ trip_id: tm.tripId, member_id: tm.memberId }),
    fromRemote: (r) => ({ id: `${r.trip_id}:${r.member_id}`, tripId: r.trip_id, memberId: r.member_id }),
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
      use_count: e.useCount,
      last_used_at: e.lastUsedAt ? iso(e.lastUsedAt) : null,
      // 本地只存布尔值，没有归档时间点；归档瞬间就用当下时间戳，足够满足
      // "是否还出现在推荐列表"这个用途，不需要精确到哪一刻归档的
      archived_at: e.archived ? iso(Date.now()) : null,
      created_at: iso(e.createdAt),
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
      useCount: r.use_count,
      lastUsedAt: r.last_used_at ? ms(r.last_used_at) : 0,
      archived: r.archived_at !== null,
      createdAt: ms(r.created_at),
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
      itinerary_day_id: e.itineraryDayId,
      itinerary_item_id: e.itineraryItemId,
      // 本地字段叫 description，远端表这一列叫 notes——纯粹是命名不统一，不是语义差异
      notes: e.description,
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
      itineraryDayId: r.itinerary_day_id,
      itineraryItemId: r.itinerary_item_id,
      description: r.notes,
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },

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
    }),
    fromRemote: (r) => ({
      id: r.id,
      householdId: r.household_id,
      expenseId: r.expense_id,
      memberId: r.member_id,
      shareAmount: num(r.share_amount),
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
      createdAt: ms(r.created_at),
      updatedAt: ms(r.updated_at),
    }),
  },
}
