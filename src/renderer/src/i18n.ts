import { initReactI18next } from 'react-i18next'
import { createI18n } from '@shared/i18n/create-i18n'
import type { Language } from '@shared/i18n/resolve-language'

/**
 * Экземпляр i18next для renderer (design D3): те же ресурсы, что и в main.
 * Язык до первой отрисовки выставляет bootstrap в main.tsx (settings:get →
 * resolvedLanguage); 'ru' здесь — безопасный placeholder самого раннего кадра.
 */
const instance = createI18n('ru', [initReactI18next])

/** Смена языка интерфейса: экземпляр + объявление языка страницы (a11y). */
export function setRendererLanguage(language: Language): void {
  void instance.changeLanguage(language)
  document.documentElement.lang = language
}

export { instance as i18n }
