// "当前行程"和"当前身份"这两个记忆值必须按团队分开存：A团队的行程ID和成员ID
// 在B团队里没有任何意义，共用一个键会导致切过去之后指向一条不存在的记录。
//
// 键名格式：<旧的全局键>:<householdId>
//
// 【为什么要搬迁旧值】这两个键原本是全局的，直接换成带后缀的新格式，等于所有
// 现有用户的记忆值一夜之间读不到了——下次打开会被弹回"选行程/选身份"。虽然只
// 发生一次，但完全可以避免：首次读取时如果新键没值、旧键有值，就把旧值归到当前
// 团队名下搬过去。
//
// 【搬完必须把旧键删掉】这一行是修 bug 修出来的，不是洁癖。第一版为了"万一要回滚
// 代码还能读到旧值"刻意保留了旧键，结果那个兜底对**每一个**团队都会生效：切到另一个
// 团队时它没有自己的作用域键，就又去读全局旧键，把上一个团队的成员ID/行程ID当成
// 这个团队的用上了。真实后果是切过去之后头像变成"?"、而且因为 memberId 有值，
// "你是谁？"那一屏被整个跳过。
//
// 旧值在语义上只属于一个团队——升级那一刻正在用的那个。所以只能被认领一次，
// 认领完就删。回滚代码的代价只是让用户重选一次身份，比跨团队身份错乱轻得多。
export function readPerTeam(baseKey: string, householdId: string): string | null {
  const scoped = `${baseKey}:${householdId}`
  const existing = localStorage.getItem(scoped)
  if (existing !== null) return existing

  const legacy = localStorage.getItem(baseKey)
  if (legacy !== null) {
    localStorage.setItem(scoped, legacy)
    localStorage.removeItem(baseKey)
    return legacy
  }
  return null
}

export function writePerTeam(baseKey: string, householdId: string, value: string): void {
  localStorage.setItem(`${baseKey}:${householdId}`, value)
}

export function removePerTeam(baseKey: string, householdId: string): void {
  localStorage.removeItem(`${baseKey}:${householdId}`)
}
