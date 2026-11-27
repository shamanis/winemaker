import { useEffect, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '../store/settings-store'
import { LANGUAGES } from '@shared/i18n/locales'

/**
 * Настройки (спека application-settings): единицы плотности, формула
 * коррекции рефрактометра и язык интерфейса (спека localization).
 * Применяются единообразно во всём интерфейсе и сразу, без перезапуска.
 */
export function SettingsScreen(): ReactElement {
  const { t } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const init = useSettingsStore((s) => s.init)
  const update = useSettingsStore((s) => s.update)

  useEffect(() => {
    void init()
  }, [init])

  if (!settings) {
    return <section className="screen"><p className="muted">{t('settings.loading')}</p></section>
  }

  const onChange = (event: FormEvent<HTMLFormElement>): void => {
    const form = new FormData(event.currentTarget)
    const unit = form.get('densityUnit')
    const formula = form.get('correctionFormula')
    const language = form.get('language')
    const patch: Parameters<typeof update>[0] = {}
    if (unit === 'sg' || unit === 'brix') patch['densityUnit'] = unit
    if (formula === 'auto' || formula === 'terrill' || formula === 'linear') {
      patch['correctionFormula'] = formula
    }
    if (language === 'system' || language === 'ru' || language === 'en') {
      patch['language'] = language
    }
    void update(patch)
  }

  return (
    <section className="screen">
      <h2>{t('settings.title')}</h2>
      <form className="form-grid" onChange={(e) => onChange(e)}>
        <label>
          {t('settings.densityUnit')}
          <select name="densityUnit" defaultValue={settings.densityUnit}>
            <option value="sg">{t('settings.densityUnit.sg')}</option>
            <option value="brix">{t('settings.densityUnit.brix')}</option>
          </select>
        </label>
        <label>
          {t('settings.correctionFormula')}
          <select name="correctionFormula" defaultValue={settings.correctionFormula}>
            <option value="auto">{t('settings.correctionFormula.auto')}</option>
            <option value="terrill">{t('settings.correctionFormula.terrill')}</option>
            <option value="linear">{t('settings.correctionFormula.linear')}</option>
          </select>
        </label>
        <label>
          {t('language.label')}
          <select name="language" defaultValue={settings.language}>
            <option value="system">{t('language.system')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {t('settings.hint')}
        </p>
      </form>
    </section>
  )
}
