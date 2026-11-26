import { useEffect, type FormEvent, type ReactElement } from 'react'
import { useSettingsStore } from '../store/settings-store'

/**
 * Настройки (спека application-settings): единицы плотности и формула
 * коррекции рефрактометра. Применяются единообразно во всём интерфейсе.
 */
export function SettingsScreen(): ReactElement {
  const settings = useSettingsStore((s) => s.settings)
  const init = useSettingsStore((s) => s.init)
  const update = useSettingsStore((s) => s.update)

  useEffect(() => {
    void init()
  }, [init])

  if (!settings) {
    return <section className="screen"><p className="muted">Загрузка настроек…</p></section>
  }

  const onChange = (event: FormEvent<HTMLFormElement>): void => {
    const form = new FormData(event.currentTarget)
    const unit = form.get('densityUnit')
    const formula = form.get('correctionFormula')
    const patch: Parameters<typeof update>[0] = {}
    if (unit === 'sg' || unit === 'brix') patch['densityUnit'] = unit
    if (formula === 'auto' || formula === 'terrill' || formula === 'linear') {
      patch['correctionFormula'] = formula
    }
    void update(patch)
  }

  return (
    <section className="screen">
      <h2>Настройки</h2>
      <form className="form-grid" onChange={(e) => onChange(e)}>
        <label>
          Единицы измерения плотности
          <select name="densityUnit" defaultValue={settings.densityUnit}>
            <option value="sg">SG (удельная плотность)</option>
            <option value="brix">Brix (°Bx)</option>
          </select>
        </label>
        <label>
          Формула коррекции рефрактометра
          <select name="correctionFormula" defaultValue={settings.correctionFormula}>
            <option value="auto">Авто — по стадии брожения (рекомендуется)</option>
            <option value="terrill">Точная — кубическая формула Террилла (после 1/3 брожения)</option>
            <option value="linear">Упрощённая — линейная (Баллинг)</option>
          </select>
        </label>
        <p className="muted">
          Настройки применяются ко всем экранам и сохраняются автоматически.
          В режиме «Авто» замеры до прохождения ~1/3 брожения корректируются
          линейной моделью (стабильна на всём этапе), далее — кубической
          формулой Террилла (точна в своей зоне).
        </p>
      </form>
    </section>
  )
}
