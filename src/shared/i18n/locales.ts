/**
 * Реестр каталогов переводов (design D12): новый язык — файл каталога
 * и одна строка здесь; коды и подписи выбора языков берутся отсюда,
 * экраны не меняются (спека localization: добавление нового языка).
 */
import ru from './locales/ru/translation.json'
import en from './locales/en/translation.json'
import type { Language } from './resolve-language'

/** Каталог одного языка: наборы ключей проверяет тест, не тип (design D7). */
type Catalog = Record<string, unknown>

export const resources: Record<Language, { translation: Catalog }> = {
  ru: { translation: ru },
  en: { translation: en }
}

/** Пункт списка языков: подпись — на самом языке (спека localization). */
export interface LanguageOption {
  readonly code: Language
  readonly nativeName: string
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'ru', nativeName: 'Русский' },
  { code: 'en', nativeName: 'English' }
]
