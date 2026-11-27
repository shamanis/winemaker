import { useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { InstrumentDto, InstrumentInput, InstrumentType, StrainDto, StrainInput } from '@shared/ipc/contracts'
import { instrumentTypeSchema } from '@shared/ipc/contracts'
import { useCatalogsStore } from '../store/catalogs-store'
import { toUtcIso } from '@shared/time/utc'
import { describeError } from '../errors'

type CatalogTab = 'instruments' | 'strains'

/**
 * Экран справочников: приборы с калибровочными параметрами и штаммы
 * дрожжей (спека reference-catalogs).
 */
export function CatalogsScreen(): ReactElement {
  const { t } = useTranslation()
  const [tab, setTab] = useState<CatalogTab>('instruments')

  return (
    <section className="screen">
      <div className="subtabs" role="tablist" aria-label={t('catalogs.ariaTabs')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'instruments'}
          className={tab === 'instruments' ? 'subtab active' : 'subtab'}
          onClick={() => setTab('instruments')}
        >
          {t('catalogs.tab.instruments')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'strains'}
          className={tab === 'strains' ? 'subtab active' : 'subtab'}
          onClick={() => setTab('strains')}
        >
          {t('catalogs.tab.strains')}
        </button>
      </div>
      {tab === 'instruments' ? <InstrumentsTab /> : <StrainsTab />}
    </section>
  )
}

function InstrumentsTab(): ReactElement {
  const { t } = useTranslation()
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
      setError(describeError(e, t))
    }
  }

  return (
    <div className="catalog">
      {hint ? (
        <aside className="hint-box">
          <strong>{t('catalogs.hint.title')}</strong>
          <p>
            {t('catalogs.hint.text')}
          </p>
          <button type="button" onClick={dismissHint}>{t('catalogs.hint.dismiss')}</button>
        </aside>
      ) : null}

      <form className="form-grid" onSubmit={(e) => void submit(e)}>
        <h3>{editing ? t('catalogs.form.editInstrument') : t('catalogs.form.newInstrument')}</h3>
        <label>
          {t('catalogs.field.name')}
          <input name="name" required defaultValue={editing?.name ?? ''} />
        </label>
        <label>
          {t('catalogs.field.type')}
          <select name="type" defaultValue={editing?.type ?? 'refractometer-atc'}>
            {instrumentTypeSchema.options.map((value) => (
              <option key={value} value={value}>{t(`catalogs.type.${value}`)}</option>
            ))}
          </select>
        </label>
        <label>
          {t('catalogs.field.wcf')}
          <input name="wcf" type="number" step="0.001" min="1" max="1.3" defaultValue={editing?.wcf ?? ''} />
        </label>
        <label>
          {t('catalogs.field.offset')}
          <input
            name="calibrationOffsetBx"
            type="number"
            step="0.1"
            min="-5"
            max="5"
            defaultValue={editing?.calibrationOffsetBx ?? ''}
          />
        </label>
        <label>
          {t('catalogs.field.tcal')}
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
          <button type="submit">{editing ? t('common.save') : t('common.add')}</button>
          {editing ? (
            <button type="button" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
          ) : null}
        </div>
      </form>

      <ul className="item-list">
        {instruments.map((instrument) => (
          <li key={instrument.id}>
            <div>
              <strong>{instrument.name}</strong> — {t(`catalogs.type.${instrument.type}`)}
              {instrument.wcf ? `, ${t('catalogs.list.wcf', { value: instrument.wcf })}` : ''}
              {instrument.calibrationOffsetBx ? `, ${t('catalogs.list.offset', { value: `${instrument.calibrationOffsetBx > 0 ? '+' : ''}${instrument.calibrationOffsetBx}` })}` : ''}
              {instrument.type === 'hydrometer' && instrument.calibrationTempC != null ? `, ${t('catalogs.list.tcal', { value: instrument.calibrationTempC })}` : ''}
              {instrument.calibrationPair ? `, ${t('catalogs.list.calibrated')}` : ''}
            </div>
            <div className="item-actions">
              {instrument.type.startsWith('refractometer') ? (
                <button type="button" onClick={() => setCalibrating(instrument)}>{t('catalogs.cal.link')}</button>
              ) : null}
              <button type="button" onClick={() => setEditing(instrument)}>{t('common.edit')}</button>
              <button type="button" onClick={() => void deleteInstrument(instrument.id)}>{t('common.delete')}</button>
            </div>
          </li>
        ))}
        {instruments.length === 0 ? <li className="muted">{t('catalogs.list.emptyInstruments')}</li> : null}
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
  const { t } = useTranslation()
  const { instrument } = props
  const [refrBrix, setRefrBrix] = useState('')
  const [hydrometerBx, setHydrometerBx] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const b = Number(refrBrix)
    const bx = Number(hydrometerBx)
    if (!Number.isFinite(b) || refrBrix.trim() === '' || !Number.isFinite(bx) || hydrometerBx.trim() === '') {
      setError(t('catalogs.cal.bothRequired'))
      return
    }
    if (b < 0 || b > 80) {
      setError(t('catalogs.cal.refrRange'))
      return
    }
    if (bx < 0 || bx > 80) {
      setError(t('catalogs.cal.hydroRange'))
      return
    }
    try {
      await props.onConfirm(b, bx)
    } catch (e) {
      setError(describeError(e, t))
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('catalogs.cal.aria')}>
      <form className="modal" onSubmit={(e) => void submit(e)}>
        <h3>{t('catalogs.cal.title', { name: instrument.name })}</h3>
        <p className="muted">
          {t('catalogs.cal.hint')}
        </p>
        <label>
          {t('catalogs.cal.refrReading')}
          <input value={refrBrix} onChange={(e) => setRefrBrix(e.target.value)} type="number" step="0.1" />
        </label>
        <label>
          {t('catalogs.cal.hydroReading')}
          <input value={hydrometerBx} onChange={(e) => setHydrometerBx(e.target.value)} type="number" step="0.1" />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">{t('catalogs.cal.submit')}</button>
          <button type="button" onClick={props.onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  )
}

function StrainsTab(): ReactElement {
  const { t } = useTranslation()
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
      setError(t('catalogs.strain.tempOrderError'))
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
      setError(describeError(e, t))
    }
  }

  return (
    <div className="catalog">
      <form className="form-grid" onSubmit={(e) => void submit(e)}>
        <h3>{editing ? t('catalogs.form.editStrain') : t('catalogs.form.newStrain')}</h3>
        <label>
          {t('catalogs.field.strainName')}
          <input name="name" required defaultValue={editing?.name ?? ''} />
        </label>
        <label>
          {t('catalogs.field.producer')}
          <input name="producer" defaultValue={editing?.producer ?? ''} />
        </label>
        <label>
          {t('catalogs.field.tempMin')}
          <input name="tempMinC" type="number" step="1" defaultValue={editing?.tempMinC ?? ''} />
        </label>
        <label>
          {t('catalogs.field.tempMax')}
          <input name="tempMaxC" type="number" step="1" defaultValue={editing?.tempMaxC ?? ''} />
        </label>
        <label>
          {t('catalogs.field.tolerance')}
          <input name="alcoholTolerancePct" type="number" step="0.5" min="0" max="25" defaultValue={editing?.alcoholTolerancePct ?? ''} />
        </label>
        <label>
          {t('catalogs.field.notes')}
          <input name="notes" defaultValue={editing?.notes ?? ''} />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">{editing ? t('common.save') : t('common.add')}</button>
          {editing ? <button type="button" onClick={() => setEditing(null)}>{t('common.cancel')}</button> : null}
        </div>
      </form>

      <ul className="item-list">
        {strains.map((strain) => (
          <li key={strain.id}>
            <div>
              <strong>{strain.name}</strong>
              {strain.producer ? ` — ${strain.producer}` : ''}
              {strain.tempMinC !== null && strain.tempMaxC !== null ? `, ${strain.tempMinC}–${strain.tempMaxC} °C` : ''}
              {strain.alcoholTolerancePct !== null ? `, ${t('catalogs.list.tolerance', { value: strain.alcoholTolerancePct })}` : ''}
            </div>
            <div className="item-actions">
              <button type="button" onClick={() => setEditing(strain)}>{t('common.edit')}</button>
              <button type="button" onClick={() => void deleteStrain(strain.id)}>{t('common.delete')}</button>
            </div>
          </li>
        ))}
        {strains.length === 0 ? <li className="muted">{t('catalogs.list.emptyStrains')}</li> : null}
      </ul>
    </div>
  )
}

/** Заглушка используется в будущих формах: ISO-строка из date-инпута. */
export function isoFromInput(dateStr: string): string {
  return dateStr ? toUtcIso(new Date(`${dateStr}T12:00:00.000Z`)) : toUtcIso(new Date())
}
