import type { SharedTripData } from '../../../types'

// 所有分享页模板组件共用同一个props形状——以后新增模板文件，只要实现这个接口，
// 不需要改数据获取逻辑（SharePage.tsx）或注册表（registry.ts）以外的任何东西
export interface ShareTemplateProps {
  data: SharedTripData
}
