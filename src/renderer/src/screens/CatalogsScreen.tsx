import { useState, type FormEvent, type ReactElement } from 'react'
import type { InstrumentDto, InstrumentInput, InstrumentType, StrainDto, StrainInput } from '@shared/ipc/contracts'
import { useCatalogsStore, INSTRUMENT_TYPE_LABELS } from '../store/catalogs-store'
import { toUtcIso } from '@shared/time/utc'

type CatalogTab = 'instruments' | 'strains'

/**
 * Экран справочников: приборы с калибровочными параметрами и штаммы
 * дрожжей (спека reference-catalogs).
 */
export function CatalogsScreen(): ReactElement {
  const [tab, setTab] = useState<CatalogTab>('instruments')

  return (
    <section className="screen">
      <div className="subtabs" role="tablist" aria-label="Справочники">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'instruments'}
          className={tab === 'instruments' ? 'subtab active' : 'subtab'}
          onClick={() => setTab('instruments')}
        >
          Приборы
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'strains'}
          className={tab === 'strains' ? 'subtab active' : 'subtab'}
          onClick={() => setTab('strains')}
        >
          Штаммы дрожжей
        </button>
      </div>
      {tab === 'instruments' ? <InstrumentsTab /> : <StrainsTab />}
    </section>
  )
}

function InstrumentsTab(): ReactElement {
  const instruments = useCatalogsStore((s) => s.instruments)
  const createInstrument = useCatalogsStore((s) => s.createInstrument)
  const updateInstrument = useCatalogsStore((s) => s.updateInstrument)
  const deleteInstrument = useCatalogsStore((s) => s.deleteInstrument)
  const calibrate = useCatalogsStore((s) => s.calibrate)
  const hint = useCatalogsStore((s) => s.firstInstrumentHint)
  const dismissHint = useCatalogsStore((s) => s.dismissFirstInstrumentHint)

  const [editing, setEditing] = useState<InstrumentDto | null>(null)
  const [calibrating, setCalibrating] = useState<InstrumentDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    // Захват до await: React обнуляет currentTarget после приостановки
    // обработчика — обращение после await даёт TypeError.
    const form = event.currentTarget
    const formData = new FormData(form)
    const type = formData.get('type') as InstrumentType
    const wcfRaw = String(formData.get('wcf') ?? '').trim()
    const offsetRaw = String(formData.get('calibrationOffsetBx') ?? '').trim()
    const tcalRaw = String(formData.get('calibrationTempC') ?? '').trim()
    const input: InstrumentInput = {
      name: String(formData.get('name') ?? '').trim(),
      type,
      wcf: wcfRaw ? Number(wcfRaw) : null,
      calibrationOffsetBx: offsetRaw ? Number(offsetRaw) : null,
      calibrationTempC: tcalRaw ? Number(tcalRaw) : null
    }
    try {
      if (editing) {
        await updateInstrument(editing.id, input)
      } else {
        await createInstrument(input)
      }
      setEditing(null)
      form.reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="catalog">
      {hint ? (
        <aside className="hint-box">
          <strong>Зачем эти параметры?</strong>
          <p>
            Температура сусла нужна для пересчёта показаний ареометра к
            калибровочной температуре прибора (T_кал). Калибровочная пара
            «рефрактометр — ареометр» позволит вычислить персональный
            коэффициент именно вашего прибора.
          </p>
          <button type="button" onClick={dismissHint}>Понятно</button>
        </aside>
      ) : null}

      <form className="form-grid" onSubmit={(e) => void submit(e)}>
        <h3>{editing ? 'Изменить прибор' : 'Новый прибор'}</h3>
        <label>
          Название
          <input name="name" required defaultValue={editing?.name ?? ''} />
        </label>
        <label>
          Тип
          <select name="type" defaultValue={editing?.type ?? 'refractometer-atc'}>
            {Object.entries(INSTRUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          WCF (для рефрактометра)
          <input name="wcf" type="number" step="0.001" min="1" max="1.3" defaultValue={editing?.wcf ?? ''} />
        </label>
        <label>
          Калибровочное смещение SG (для ареометра)
          <input
            name="calibrationOffsetBx"
            type="number"
            step="0.0001"
            min="-0.05"
            max="0.05"
            defaultValue={editing?.calibrationOffsetBx ?? ''}
          />
        </label>
        <label>
          T_кал ареометра, °C (по умолчанию 20)
          <input
            name="calibrationTempC"
            type="number"
            step="0.5"
            min="0"
            max="30"
            defaultValue={editing?.calibrationTempC ?? 20}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">{editing ? 'Сохранить' : 'Добавить'}</button>
          {editing ? (
            <button type="button" onClick={() => setEditing(null)}>Отмена</button>
          ) : null}
        </div>
      </form>

      <ul className="item-list">
        {instruments.map((instrument) => (
          <li key={instrument.id}>
            <div>
              <strong>{instrument.name}</strong> — {INSTRUMENT_TYPE_LABELS[instrument.type]}
              {instrument.wcf ? `, WCF ${instrument.wcf}` : ''}
              {instrument.calibrationOffsetBx ? `, смещение ${instrument.calibrationOffsetBx > 0 ? '+' : ''}${instrument.calibrationOffsetBx} SG` : ''}
              {instrument.type === 'hydrometer' && instrument.calibrationTempC != null ? `, T_кал ${instrument.calibrationTempC} °C` : ''}
              {instrument.calibrationPair ? ', калибрована по паре' : ''}
            </div>
            <div className="item-actions">
              {instrument.type.startsWith('refractometer') ? (
                <button type="button" onClick={() => setCalibrating(instrument)}>Калибровка</button>
              ) : null}
              <button type="button" onClick={() => setEditing(instrument)}>Изменить</button>
              <button type="button" onClick={() => void deleteInstrument(instrument.id)}>Удалить</button>
            </div>
          </li>
        ))}
        {instruments.length === 0 ? <li className="muted">Приборов пока нет — добавьте первый выше.</li> : null}
      </ul>

      {calibrating ? (
        <CalibrationDialog
          instrument={calibrating}
          onClose={() => setCalibrating(null)}
          onConfirm={async (refrBrix, hydrometerBx) => {
            await calibrate(calibrating.id, refrBrix, hydrometerBx)
            setCalibrating(null)
          }}
        />
      ) : null}
    </div>
  )
}

function CalibrationDialog(props: {
  instrument: InstrumentDto
  onConfirm(refrBrix: number, hydrometerBx: number): Promise<void>
  onClose(): void
}): ReactElement {
  const { instrument } = props
  const [refrBrix, setRefrBrix] = useState('')
  const [hydrometerBx, setHydrometerSg] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const b = Number(refrBrix)
    const sg = Number(hydrometerBx)
    if (!Number.isFinite(b) || refrBrix.trim() === '' || !Number.isFinite(sg) || hydrometerBx.trim() === '') {
      setError('Введите оба показания')
      return
    }
    if (b < 0 || b > 80) {
      setError('Brix вне диапазона 0–80')
      return
    }
    if (sg < 0.9 || sg > 1.2) {
      setError('SG вне диапазона 0.9–1.2')
      return
    }
    try {
      await props.onConfirm(b, sg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Калибровочная пара">
      <form className="modal" onSubmit={(e) => void submit(e)}>
        <h3>Калибровка — {instrument.name}</h3>
        <p className="muted">
          Отмерьте один образец сусла и замерьте его обоими приборами:
          персональный WCF вычислится из пары и будет применяться к замерам
          этого рефрактометра вместо усреднённого.
        </p>
        <label>
          Показание рефрактометра, °Bx
          <input value={refrBrix} onChange={(e) => setRefrBrix(e.target.value)} type="number" step="0.1" />
        </label>
        <label>
          Показание ареометра, SG
          <input value={hydrometerBx} onChange={(e) => setHydrometerSg(e.target.value)} type="number" step="0.0001" />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">Вычислить и применить</button>
          <button type="button" onClick={props.onClose}>Отмена</button>
        </div>
      </form>
    </div>
  )
}

function StrainsTab(): ReactElement {
  const strains = useCatalogsStore((s) => s.strains)
  const createStrain = useCatalogsStore((s) => s.createStrain)
  const updateStrain = useCatalogsStore((s) => s.updateStrain)
  const deleteStrain = useCatalogsStore((s) => s.deleteStrain)

  const [editing, setEditing] = useState<StrainDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const formData = new FormData(form)
    const num = (key: string): number | null => {
      const raw = String(formData.get(key) ?? '').trim()
      return raw ? Number(raw) : null
    }
    const tempMinC = num('tempMinC')
    const tempMaxC = num('tempMaxC')
    if (tempMinC !== null && tempMaxC !== null && tempMinC > tempMaxC) {
      setError('Минимальная температура не может превышать максимальную')
      return
    }
    const input: StrainInput = {
      name: String(formData.get('name') ?? '').trim(),
      producer: String(formData.get('producer') ?? '').trim() || null,
      tempMinC,
      tempMaxC,
      alcoholTolerancePct: num('alcoholTolerancePct'),
      notes: String(formData.get('notes') ?? '').trim() || null
    }
    try {
      if (editing) {
        await updateStrain(editing.id, input)
      } else {
        await createStrain(input)
      }
      setEditing(null)
      form.reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="catalog">
      <form className="form-grid" onSubmit={(e) => void submit(e)}>
        <h3>{editing ? 'Изменить штамм' : 'Новый штамм'}</h3>
        <label>
          Название штамма
          <input name="name" required defaultValue={editing?.name ?? ''} />
        </label>
        <label>
          Производитель
          <input name="producer" defaultValue={editing?.producer ?? ''} />
        </label>
        <label>
          Опт. температура, °C (от)
          <input name="tempMinC" type="number" step="1" defaultValue={editing?.tempMinC ?? ''} />
        </label>
        <label>
          Опт. температура, °C (до)
          <input name="tempMaxC" type="number" step="1" defaultValue={editing?.tempMaxC ?? ''} />
        </label>
        <label>
          Толерантность к спирту, % об.
          <input name="alcoholTolerancePct" type="number" step="0.5" min="0" max="25" defaultValue={editing?.alcoholTolerancePct ?? ''} />
        </label>
        <label>
          Заметки
          <input name="notes" defaultValue={editing?.notes ?? ''} />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">{editing ? 'Сохранить' : 'Добавить'}</button>
          {editing ? <button type="button" onClick={() => setEditing(null)}>Отмена</button> : null}
        </div>
      </form>

      <ul className="item-list">
        {strains.map((strain) => (
          <li key={strain.id}>
            <div>
              <strong>{strain.name}</strong>
              {strain.producer ? ` — ${strain.producer}` : ''}
              {strain.tempMinC !== null && strain.tempMaxC !== null ? `, ${strain.tempMinC}–${strain.tempMaxC} °C` : ''}
              {strain.alcoholTolerancePct !== null ? `, до ${strain.alcoholTolerancePct} % об.` : ''}
            </div>
            <div className="item-actions">
              <button type="button" onClick={() => setEditing(strain)}>Изменить</button>
              <button type="button" onClick={() => void deleteStrain(strain.id)}>Удалить</button>
            </div>
          </li>
        ))}
        {strains.length === 0 ? <li className="muted">Штаммов пока нет — добавьте первый выше.</li> : null}
      </ul>
    </div>
  )
}

/** Заглушка используется в будущих формах: ISO-строка из date-инпута. */
export function isoFromInput(dateStr: string): string {
  return dateStr ? toUtcIso(new Date(`${dateStr}T12:00:00.000Z`)) : toUtcIso(new Date())
}
