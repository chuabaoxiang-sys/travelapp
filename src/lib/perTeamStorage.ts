// "当前行程"和"当前身份"这两个记忆值必须按团队分开存：A团队的行程ID和成员ID
// 在B团队里没有任何意义，共用一个键会导致切过去之后指向一条不存在的记录。
//
// 键名格式：<旧的全局键>:<householdId>
//
// 【为什么要搬迁旧值】这两个键原本是全局的，直接换成带后缀的新格式，等于所有
// 现有用户的记忆值一夜之间读不到了——下次打开会被弹回"选行程/选身份"。虽然只
// 发生一次，但完全可以避免：首次读取时如果新键没值、旧键有值，就把旧值归到当前
// 团队名下搬过去。搬完不删旧键，万一以后需要回滚代码，旧版本还能读到原来的值。
export function readPerTeam(baseKey: string, householdId: string): string | null {
  const scoped = `${baseKey}:${householdId}`
  const existing = localStorage.getItem(scoped)
  if (existing !== null) return existing

  const legacy = localStorage.getItem(baseKey)
  if (legacy !== null) {
    localStorage.setItem(scoped, legacy)
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
