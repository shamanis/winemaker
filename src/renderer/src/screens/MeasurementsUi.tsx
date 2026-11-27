import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { BatchDto, MeasurementDto, MeasurementKind } from '@shared/ipc/contracts'
import { measurementKindSchema } from '@shared/ipc/contracts'
import { resolveMeasurement, type PipelineContext, type TraceMessage } from '@shared/calculations/pipeline'
import { formatDensity } from '@shared/calculations/analysis'
import { toUtcIso } from '@shared/time/utc'
import { useCatalogsStore } from '../store/catalogs-store'
import { Modal } from '../ui/Modal'
import { useSettingsStore } from '../store/settings-store'
import {
  useMeasurementsStore,
  lastDensityMeasurement
} from '../store/measurements-store'
import { describeError } from '../errors'

/** Сообщение следа к тексту: по коду на текущем языке; записи без кодов — сохранённый текст. */
function traceText(
  message: string | undefined,
  code: TraceMessage | undefined,
  t: ReturnType<typeof useTranslation>['t']
): string | null {
  if (code) return t(code.code, { ...code.params })
  return message ?? null
}

/** Собирает контекст коррекции на клиенте — те же данные, что и на сервере. */
function buildContext(batch: BatchDto, instrumentId: string | null): PipelineContext {
  const instruments = useCatalogsStore.getState().instruments
  const formula = useSettingsStore.getState().settings?.correctionFormula ?? 'terrill'
  const instrument = instruments.find((i) => i.id === instrumentId)
  const startParams = batch.startParams as {
    gravity: { raw: { value: number; unit: 'sg' | 'brix' }; ogSg: number }
  }
  return {
    instrument: instrument
      ? {
          type: instrument.type,
          wcf: instrument.wcf ?? null,
          calibrationOffsetBx: instrument.calibrationOffsetBx ?? null,
          calibrationTempC: instrument.calibrationTempC ?? null,
          hasCalibrationPair: instrument.calibrationPair != null
        }
      : null,
    correctionFormula: formula,
    startRawGravity: startParams.gravity.raw,
    startOgSg: startParams.gravity.ogSg,
    batchStartDateUtc: batch.startDateUtc
  }
}

/**
 * Диалог ввода/правки замера. В режиме создания остаётся открытым после
 * сохранения — пакетный ввод (спека 6.1.7); Enter сохраняет (6.1.1).
 */
export function MeasurementDialog(props: {
  batch: BatchDto
  onClose(): void
}): ReactElement {
  const { batch, onClose } = props
  const { t } = useTranslation()
  const instruments = useCatalogsStore((s) => s.instruments)
  const catalogsLoaded = useCatalogsStore((s) => s.loaded)
  const initCatalogs = useCatalogsStore((s) => s.init)
  const settings = useSettingsStore((s) => s.settings)
  const measurementsByBatch = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const create = useMeasurementsStore((s) => s.create)

  // Диалог может открыться прямо из списка — справочник приборов ещё
  // мог не загрузиться (иначе предпросмотр найдёт null-прибор).
  useEffect(() => {
    if (!catalogsLoaded) void initCatalogs()
  }, [catalogsLoaded, initCatalogs])

  const last = useMemo(() => lastDensityMeasurement(measurementsByBatch), [measurementsByBatch])

  const nowLocal = useMemo(() => {
    const d = new Date()
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    return d.toISOString().slice(0, 16)
  }, [])

  const [kind, setKind] = useState<MeasurementKind>('density')
  const [rawValue, setRawValue] = useState('')
  const [unit, setUnit] = useState<'sg' | 'brix'>(settings?.densityUnit ?? 'sg')
  const [instrumentId, setInstrumentId] = useState<string>(last?.instrumentId ?? '')
  const [tempC, setTempC] = useState<string>(last?.tempC != null ? String(last.tempC) : '')
  const [measuredAt, setMeasuredAt] = useState<string>(nowLocal)
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const valueRef = useRef<HTMLInputElement | null>(null)

  // Дефолты из последнего замера партии (спека 6.1.4) — в том числе когда
  // диалог открыт прямо из списка, а не из карточки.
  useEffect(() => {
    void loadFor(batch.id)
  }, [batch.id, loadFor])

  useEffect(() => {
    if (defaultsApplied || !last) return
    if (!instrumentId && last.instrumentId) setInstrumentId(last.instrumentId)
    if (!tempC && last.tempC != null) setTempC(String(last.tempC))
    setDefaultsApplied(true)
  }, [defaultsApplied, last, instrumentId, tempC])

  useEffect(() => {
    valueRef.current?.focus()
  }, [savedCount, kind])

  const instrument = instruments.find((i) => i.id === instrumentId) ?? null
  const isHydrometer = instrument?.type === 'hydrometer'

  // Ареометры пользователя имеют только шкалу Brix — при выборе ареометра
  // единицы переключаются на °Bx автоматически.
  useEffect(() => {
    if (instrument?.type === 'hydrometer') setUnit('brix')
  }, [instrument?.type])

  const preview = useMemo(() => {
    const value = Number(rawValue)
    if (kind !== 'density' || rawValue.trim() === '' || !Number.isFinite(value)) return null
    if (!instrumentId) return { error: t('errors.instrumentRequired') }
    const selected = instruments.find((i) => i.id === instrumentId)
    if (!selected) return { error: t('errors.instrumentNotFound') }
    if (unit === 'brix' && (value < 0 || value > 80)) return { error: t('measurements.preview.brixRange') }
    if (unit === 'sg' && (value < 0.9 || value > 1.2)) return { error: t('measurements.preview.sgRange') }
    if (isHydrometer && tempC.trim() !== '' && !Number.isFinite(Number(tempC))) {
      return { error: t('measurements.preview.badTemp') }
    }
    return {
      resolved: resolveMeasurement(
        {
          kind: 'density',
          rawValue: value,
          unit,
          tempC: tempC.trim() === '' ? null : Number(tempC),
          measuredAtUtc: measuredAt ? toUtcIso(new Date(measuredAt)) : toUtcIso(new Date())
        },
        buildContext(batch, instrumentId)
      )
    }
  }, [kind, rawValue, unit, instrumentId, tempC, isHydrometer, batch, measuredAt, instruments, t])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const value = Number(rawValue)
    if (rawValue.trim() === '' || !Number.isFinite(value)) {
      setError(t('measurements.enterValue'))
      return
    }
    const input = {
      batchId: batch.id,
      kind,
      instrumentId: kind === 'density' ? instrumentId || null : null,
      rawValue: value,
      unit,
      tempC: kind === 'density' && tempC.trim() !== '' ? Number(tempC) : null,
      measuredAtUtc: measuredAt ? toUtcIso(new Date(measuredAt)) : toUtcIso(new Date())
    }
    try {
      await create(input)
      setSavedCount((n) => n + 1)
      setRawValue('')
    } catch (e) {
      setError(describeError(e, t))
    }
  }

  return (
    <Modal title={t('measurements.title')} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {savedCount > 0 ? (
          <p className="muted">{t('measurements.savedCount', { count: savedCount })}</p>
        ) : null}

        <label>
          {t('measurements.measuredAt')}
          <input
            type="datetime-local"
            value={measuredAt}
            onChange={(e) => setMeasuredAt(e.target.value)}
          />
        </label>

        <label>
          {t('measurements.kindLabel')}
          <select value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
            {measurementKindSchema.options.map((v) => (
              <option key={v} value={v}>{t(`measurements.kind.${v}`)}</option>
            ))}
          </select>
        </label>

        {kind === 'density' ? (
          <>
            <div className="inline-fields">
              <label>
                {t('measurements.field.reading')} ({unit === 'brix' ? '°Bx' : 'SG'})
                <input
                  ref={valueRef}
                  value={rawValue}
                  onChange={(e) => setRawValue(e.target.value)}
                  type="number"
                  step="0.001"
                  autoFocus
                />
              </label>
              <label>
                {t('measurements.field.units')}
                <select value={unit} onChange={(e) => setUnit(e.target.value as 'sg' | 'brix')}>
                  <option value="brix">Brix</option>
                  <option value="sg">SG</option>
                </select>
              </label>
            </div>
            <label>
              {t('measurements.field.instrument')}
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
              >
                <option value="">{t('measurements.chooseInstrument')}</option>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({t(`catalogs.type.${i.type}`)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {isHydrometer ? t('measurements.tempHydrometer') : t('measurements.temp')}
              <input
                value={tempC}
                onChange={(e) => setTempC(e.target.value)}
                type="number"
                step="0.1"
                min="-5"
                max="60"
              />
            </label>

            <div aria-live="polite">
              {preview && 'error' in preview && preview.error ? (
                <p className="error-text">{preview.error}</p>
              ) : null}
              {preview && 'resolved' in preview && preview.resolved ? (
                <>
                  <p className="muted">
                    {t('measurements.preview.corrected')}{' '}
                    <strong>
                      {formatDensity(preview.resolved.correctedSg, unit)}
                    </strong>
                  </p>
                  {preview.resolved.warnings.map((w, idx) => (
                    <p key={`${w.code}-${idx}`} className="error-text">⚠ {t(w.code, { ...w.params })}</p>
                  ))}
                  {preview.resolved.infos.map((i, idx) => (
                    <p key={`${i.code}-${idx}`} className="info-text">ℹ {t(i.code, { ...i.params })}</p>
                  ))}
                </>
              ) : null}
            </div>
          </>
        ) : (
          <label>
            {t(`measurements.kind.${kind}`)}
            <input
              ref={valueRef}
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              type="number"
              step="0.01"
              autoFocus
            />
          </label>
        )}

        {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <button type="submit">{t('common.save')}</button>
        <button type="button" onClick={onClose}>{t('common.close')}</button>
      </div>
    </form>
    </Modal>
  )
}

/** Секция «Замеры» в карточке партии: хронология, след, ревизии. */
export function MeasurementsSection(props: { batch: BatchDto }): ReactElement {
  const { t } = useTranslation()
  const { batch } = props
  const list = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const remove = useMeasurementsStore((s) => s.remove)
  const densityUnit = useSettingsStore((s) => s.settings?.densityUnit ?? 'sg')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    void loadFor(batch.id)
  }, [batch.id, loadFor])

  const detail = detailId ? list?.find((m) => m.id === detailId) ?? null : null

  return (
    <section className="measurements">
      <div className="screen-header">
        <h3>{t('measurements.section.title')}</h3>
        <button
          type="button"
          className="btn-fab"
          title={t('measurements.section.new')}
          aria-label={t('measurements.section.new')}
          onClick={() => setDialogOpen(true)}
        >
          +
        </button>
      </div>

      <ul className="item-list">
        {(list ?? []).map((m) => {
          const stored = m.corrections as { warnings?: string[]; warningCodes?: TraceMessage[]; infos?: string[]; infoCodes?: TraceMessage[] }
          const warnings = stored.warnings ?? []
          const infos = stored.infos ?? []
          return (
            <li key={m.id}>
            <button
              type="button"
              className="item-open"
              onClick={() => setDetailId(m.id)}
              title={t('measurements.section.openCard')}
            >
              <div>
                <strong>{t(`measurements.kind.${m.kind}`)}</strong>:{' '}
                {m.kind === 'density'
                  ? `${m.rawValue} ${m.unit === 'brix' ? '°Bx' : 'SG'} → ${formatDensity(m.correctedSg, densityUnit)}`
                  : `${m.rawValue} ${m.kind === 'temperature' ? '°C' : 'pH'}`}
                {warnings.length > 0 ? ' ⚠' : ''}{infos.length > 0 ? ' ℹ' : ''}
              </div>
              <div className="muted">{m.measuredAtUtc.slice(0, 16).replace('T', ' ')} UTC</div>
            </button>
              <div className="item-actions">
                <button type="button" onClick={() => setConfirmDelete(m.id)}>{t('common.delete')}</button>
              </div>
            </li>
          )
        })}
        {(list ?? []).length === 0 ? (
          <li className="muted">{t('measurements.section.empty')}</li>
        ) : null}
      </ul>

      {detail ? (
        <MeasurementDetail
          measurement={detail}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {dialogOpen ? (
        <MeasurementDialog
          batch={batch}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}

      {confirmDelete ? (
        <DeleteMeasurementDialog
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            void remove(confirmDelete, batch.id)
            setConfirmDelete(null)
          }}
        />
      ) : null}
    </section>
  )
}

/** Двойное подтверждение удаления: чекбокс осознанности + кнопка. */
function DeleteMeasurementDialog(props: {
  onConfirm(): void
  onClose(): void
}): ReactElement {
  const { t } = useTranslation()
  const [checked, setChecked] = useState(false)
  return (
    <Modal title={t('measurements.deleteTitle')} onClose={props.onClose}>
      <p>
        {t('measurements.deleteText')}
      </p>
      <label className="confirm-checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {t('measurements.awareCheckbox')}
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="danger"
          disabled={!checked}
          title={checked ? undefined : t('measurements.awareRequired')}
          onClick={props.onConfirm}
        >
          {t('common.delete')}
        </button>
        <button type="button" onClick={props.onClose}>{t('common.cancel')}</button>
      </div>
    </Modal>
  )
}

function MeasurementDetail(props: {
  measurement: MeasurementDto
  onClose(): void
}): ReactElement {
  const { t } = useTranslation()
  const { measurement: m, onClose } = props
  const densityUnit = useSettingsStore((s) => s.settings?.densityUnit ?? 'sg')
  const stored = m.corrections as {
    steps?: Array<{ type: string; input: number; output: number; note?: string; code?: string; params?: Record<string, string | number> }>
    warnings?: string[]
    warningCodes?: TraceMessage[]
    infos?: string[]
    infoCodes?: TraceMessage[]
  }
  const steps = stored.steps ?? []
  const warnings = stored.warnings ?? []
  const warningCodes = stored.warningCodes ?? []
  const infos = stored.infos ?? []
  const infoCodes = stored.infoCodes ?? []
  const instrument = useCatalogsStore((s) => s.instruments.find((i) => i.id === m.instrumentId))

  return (
    <Modal title={`${t('measurements.title')} — ${t(`measurements.kind.${m.kind}`)}`} onClose={onClose}>
        <dl className="detail-list">
          <dt>{t('measurements.detail.raw')}</dt>
          <dd>
            {m.rawValue} {m.kind === 'density' ? (m.unit === 'brix' ? '°Bx' : 'SG') : m.kind === 'temperature' ? '°C' : 'pH'}
          </dd>
          {m.kind === 'density' ? (
            <>
              <dt>{t('measurements.detail.instrument')}</dt>
              <dd>{instrument ? instrument.name : '—'}</dd>
              {m.tempC != null ? (
                <>
                  <dt>{t('measurements.detail.temp')}</dt>
                  <dd>{m.tempC} °C</dd>
                </>
              ) : null}
              <dt>{t('measurements.detail.corrected')}</dt>
              <dd>
                {formatDensity(m.correctedSg, densityUnit)}
                {m.correctedBrix != null ? ` · ${t('measurements.detail.wcfReading', { value: m.correctedBrix.toFixed(2) })}` : ''}
              </dd>
            </>
          ) : null}
          <dt>{t('measurements.detail.time')}</dt>
          <dd>{m.measuredAtUtc.slice(0, 16).replace('T', ' ')} UTC</dd>
        </dl>

        <h4>{t('measurements.detail.traceTitle')}</h4>
        <ol>
          {steps.map((s, idx) => {
            const text = s.code ? t(s.code, { ...s.params }) : s.note
            return (
              <li key={idx}>
                <strong>{s.type}</strong>: {s.input} → {s.output}
                {text ? <div className="muted">{text}</div> : null}
              </li>
            )
          })}
          {steps.length === 0 ? <li className="muted">{t('measurements.detail.noCorrections')}</li> : null}
        </ol>
        {warnings.map((w, idx) => {
          const text = traceText(w, warningCodes[idx], t)
          return text ? <p key={`${idx}-${text.slice(0, 8)}`} className="error-text">⚠ {text}</p> : null
        })}
        {infos.map((i, idx) => {
          const text = traceText(i, infoCodes[idx], t)
          return text ? <p key={`${idx}-${text.slice(0, 8)}`} className="info-text">ℹ {text}</p> : null
        })}

      <div className="form-actions">
        <button type="button" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Modal>
  )
}

/**
 * Карточка замера с автозагрузкой ревизий — общая для списка и графика
 * (спека density-chart: точка → карточка замера).
 */
export function MeasurementDetailModal(props: {
  measurement: MeasurementDto
  onClose(): void
}): ReactElement {
  return (
    <MeasurementDetail
      measurement={props.measurement}
      onClose={props.onClose}
    />
  )
}
