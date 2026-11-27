import { describe, expect, it } from 'vitest'
import { resolveLanguage } from '../src/shared/i18n/resolve-language'
import { createI18n } from '../src/shared/i18n/create-i18n'
import { LANGUAGES } from '../src/shared/i18n/locales'

describe('resolveLanguage — язык по умолчанию (спека localization)', () => {
  it('русская система: ru и ru-RU дают ru', () => {
    expect(resolveLanguage('system', 'ru')).toBe('ru')
    expect(resolveLanguage('system', 'ru-RU')).toBe('ru')
    expect(resolveLanguage('system', 'ru_UA')).toBe('ru')
  })

  it('система с другим языком: de-DE, en-US и пустая строка дают en', () => {
    expect(resolveLanguage('system', 'de-DE')).toBe('en')
    expect(resolveLanguage('system', 'en-US')).toBe('en')
    expect(resolveLanguage('system', 'fr')).toBe('en')
    expect(resolveLanguage('system', undefined)).toBe('en')
  })

  it('явный выбор возвращает выбранный код при любой системе', () => {
    expect(resolveLanguage('ru', 'en-US')).toBe('ru')
    expect(resolveLanguage('en', 'ru-RU')).toBe('en')
  })

  it('неизвестный код даёт en (резервный язык)', () => {
    expect(resolveLanguage('de' as never, 'ru-RU')).toBe('en')
  })
})

describe('createI18n — фабрика экземпляров (design D3)', () => {
  it('инициализируется синхронно и переводит на заданном языке', () => {
    const ru = createI18n('ru')
    expect(ru.t('tabs.batches')).toBe('Партии')
    const en = createI18n('en')
    expect(en.t('tabs.batches')).toBe('Batches')
  })

  it('именованные форматы чисел применяются при интерполяции (design D10)', () => {
    const ru = createI18n('ru')
    const en = createI18n('en')
    expect(ru.t('format.abv', { value: 12.34 })).toBe('12.3 % об.')
    expect(en.t('format.abv', { value: 12.34 })).toBe('12.3 % ABV')
    expect(
      ru.t('trace.calibrationOffset', { offset: '+0.5' })
    ).toBe('Калибровочное смещение прибора +0.5 °Bx')
    expect(
      en.t('trace.hydrometerTemp', { tCal: 20, tMust: 24.5 })
    ).toBe('Temperature correction to T_cal 20 °C (must 24.5 °C)')
  })

  it('реестр языков содержит подписи на самих языках', () => {
    expect(LANGUAGES.map((l) => `${l.code}:${l.nativeName}`)).toEqual([
      'ru:Русский',
      'en:English'
    ])
  })
})
