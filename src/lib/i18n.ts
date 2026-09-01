import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from '../locales/zh.json'
import en from '../locales/en.json'

// Phase 1起，文案按功能区分批从locales/*.json搬进来——还没搬到的字符串
// 暂时还是内联在组件里的中文字面量，不影响没搬到的部分正常显示
i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
})

export default i18n
