import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { BatchDto, MeasurementDto, MeasurementKind } from '@shared/ipc/contracts'
import { resolveMeasurement, type PipelineContext } from '@shared/calculations/pipeline'
import { formatDensity } from '@shared/calculations/analysis'
import { toUtcIso } from '@shared/time/utc'
import { useCatalogsStore, INSTRUMENT_TYPE_LABELS } from '../store/catalogs-store'
import { Modal } from '../ui/Modal'
import { useSettingsStore } from '../store/settings-store'
import {
  useMeasurementsStore,
  lastDensityMeasurement
} from '../store/measurements-store'

const KIND_LABELS: Record<MeasurementKind, string> = {
  density: 'Плотность',
  temperature: 'Температура',
  ph: 'pH'
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
          calibrationOffsetSg: instrument.calibrationOffsetSg ?? null,
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

  const preview = useMemo(() => {
    const value = Number(rawValue)
    if (kind !== 'density' || rawValue.trim() === '' || !Number.isFinite(value)) return null
    if (!instrumentId) return { error: 'Для замера плотности укажите прибор' }
    const selected = instruments.find((i) => i.id === instrumentId)
    if (!selected) return { error: 'Прибор не найден в справочнике' }
    if (unit === 'brix' && (value < 0 || value > 80)) return { error: 'Brix вне диапазона 0–80' }
    if (unit === 'sg' && (value < 0.9 || value > 1.2)) return { error: 'SG вне диапазона 0.9–1.2' }
    if (isHydrometer && tempC.trim() !== '' && !Number.isFinite(Number(tempC))) {
      return { error: 'Температура введена неверно' }
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
  }, [kind, rawValue, unit, instrumentId, tempC, isHydrometer, batch, measuredAt, instruments])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const value = Number(rawValue)
    if (rawValue.trim() === '' || !Number.isFinite(value)) {
      setError('Введите значение')
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
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="Замер" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {savedCount > 0 ? (
          <p className="muted">Сохранено замеров за этот сеанс: {savedCount}</p>
        ) : null}

        <label>
          Дата и время замера
          <input
            type="datetime-local"
            value={measuredAt}
            onChange={(e) => setMeasuredAt(e.target.value)}
          />
        </label>

        <label>
          Тип замера
          <select value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
            {Object.entries(KIND_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>

        {kind === 'density' ? (
          <>
            <div className="inline-fields">
              <label>
                Показание ({unit === 'brix' ? '°Bx' : 'SG'})
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
                Единицы
                <select value={unit} onChange={(e) => setUnit(e.target.value as 'sg' | 'brix')}>
                  <option value="brix">Brix</option>
                  <option value="sg">SG</option>
                </select>
              </label>
            </div>
            <label>
              Прибор
              <select
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
              >
                <option value="">— выберите прибор —</option>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({INSTRUMENT_TYPE_LABELS[i.type]})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {isHydrometer ? 'Температура сусла, °C (обязательна для ареометра)' : 'Температура сусла, °C'}
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
                    Скорректированное значение:{' '}
                    <strong>
                      {formatDensity(preview.resolved.correctedSg, unit)}
                    </strong>
                  </p>
                  {preview.resolved.warnings.map((w) => (
                    <p key={w} className="error-text">⚠ {w}</p>
                  ))}
                  {preview.resolved.infos.map((i) => (
                    <p key={i} className="info-text">ℹ {i}</p>
                  ))}
                </>
              ) : null}
            </div>
          </>
        ) : (
          <label>
            {KIND_LABELS[kind]}
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
        <button type="submit">Сохранить (Enter)</button>
        <button type="button" onClick={onClose}>Закрыть</button>
      </div>
    </form>
    </Modal>
  )
}

/** Секция «Замеры» в карточке партии: хронология, след, ревизии. */
export function MeasurementsSection(props: { batch: BatchDto }): ReactElement {
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
        <h3>Замеры</h3>
        <button
          type="button"
          className="btn-fab"
          title="Новый замер"
          aria-label="Новый замер"
          onClick={() => setDialogOpen(true)}
        >
          +
        </button>
      </div>

      <ul className="item-list">
        {(list ?? []).map((m) => {
          const warnings = (m.corrections as { warnings?: string[] }).warnings ?? []
          const infos = (m.corrections as { infos?: string[] }).infos ?? []
          return (
            <li key={m.id}>
            <button
              type="button"
              className="item-open"
              onClick={() => setDetailId(m.id)}
              title="Открыть карточку замера"
            >
              <div>
                <strong>{KIND_LABELS[m.kind]}</strong>:{' '}
                {m.kind === 'density'
                  ? `${m.rawValue} ${m.unit === 'brix' ? '°Bx' : 'SG'} → ${formatDensity(m.correctedSg, densityUnit)}`
                  : `${m.rawValue} ${m.kind === 'temperature' ? '°C' : 'pH'}`}
                {warnings.length > 0 ? ' ⚠' : ''}{infos.length > 0 ? ' ℹ' : ''}
              </div>
              <div className="muted">{m.measuredAtUtc.slice(0, 16).replace('T', ' ')} UTC</div>
            </button>
              <div className="item-actions">
                <button type="button" onClick={() => setConfirmDelete(m.id)}>Удалить</button>
              </div>
            </li>
          )
        })}
        {(list ?? []).length === 0 ? (
          <li className="muted">Замеров пока нет.</li>
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
  const [checked, setChecked] = useState(false)
  return (
    <Modal title="Удалить замер?" onClose={props.onClose}>
      <p>
        Замер исчезнет из графика и расчётов. Снапшот сохранится в выгрузке
        партии для аудита.
      </p>
      <label className="confirm-checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        Я точно понимаю, что делаю
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="danger"
          disabled={!checked}
          title={checked ? undefined : 'Сначала подтвердите осознанность'}
          onClick={props.onConfirm}
        >
          Удалить
        </button>
        <button type="button" onClick={props.onClose}>Отмена</button>
      </div>
    </Modal>
  )
}

function MeasurementDetail(props: {
  measurement: MeasurementDto
  onClose(): void
}): ReactElement {
  const { measurement: m, onClose } = props
  const densityUnit = useSettingsStore((s) => s.settings?.densityUnit ?? 'sg')
  const steps = (m.corrections as { steps?: Array<{ type: string; input: number; output: number; note?: string }>; warnings?: string[]; infos?: string[] }).steps ?? []
  const warnings = (m.corrections as { warnings?: string[] }).warnings ?? []
  const infos = (m.corrections as { infos?: string[] }).infos ?? []
  const instrument = useCatalogsStore((s) => s.instruments.find((i) => i.id === m.instrumentId))

  return (
    <Modal title={`Замер — ${KIND_LABELS[m.kind]}`} onClose={onClose}>
        <dl className="detail-list">
          <dt>Сырое значение</dt>
          <dd>
            {m.rawValue} {m.kind === 'density' ? (m.unit === 'brix' ? '°Bx' : 'SG') : m.kind === 'temperature' ? '°C' : 'pH'}
          </dd>
          {m.kind === 'density' ? (
            <>
              <dt>Прибор</dt>
              <dd>{instrument ? instrument.name : '—'}</dd>
              {m.tempC != null ? (
                <>
                  <dt>Температура сусла</dt>
                  <dd>{m.tempC} °C</dd>
                </>
              ) : null}
              <dt>Скорректировано</dt>
              <dd>
                {formatDensity(m.correctedSg, densityUnit)}
                {m.correctedBrix != null ? ` · WCF-показание ${m.correctedBrix.toFixed(2)} °Bx` : ''}
              </dd>
            </>
          ) : null}
          <dt>Время замера</dt>
          <dd>{m.measuredAtUtc.slice(0, 16).replace('T', ' ')} UTC</dd>
        </dl>

        <h4>След коррекции</h4>
        <ol>
          {steps.map((s, idx) => (
            <li key={idx}>
              <strong>{s.type}</strong>: {s.input} → {s.output}
              {s.note ? <div className="muted">{s.note}</div> : null}
            </li>
          ))}
          {steps.length === 0 ? <li className="muted">Коррекции не применялись</li> : null}
        </ol>
        {warnings.map((w) => (
          <p key={w} className="error-text">⚠ {w}</p>
        ))}
        {infos.map((i) => (
          <p key={i} className="info-text">ℹ {i}</p>
        ))}

      <div className="form-actions">
        <button type="button" onClick={onClose}>Закрыть</button>
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
