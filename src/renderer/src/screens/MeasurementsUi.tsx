import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { BatchDto, MeasurementDto, MeasurementKind } from '@shared/ipc/contracts'
import { resolveMeasurement, type PipelineContext } from '@shared/calculations/pipeline'
import { toUtcIso } from '@shared/time/utc'
import { useCatalogsStore, INSTRUMENT_TYPE_LABELS } from '../store/catalogs-store'
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
    gravity: { correctedBrix?: number | null; ogSg: number }
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
    startCorrectedBrix: startParams.gravity.correctedBrix ?? null,
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
  existing?: MeasurementDto | null
  onClose(): void
}): ReactElement {
  const { batch, existing, onClose } = props
  const instruments = useCatalogsStore((s) => s.instruments)
  const catalogsLoaded = useCatalogsStore((s) => s.loaded)
  const initCatalogs = useCatalogsStore((s) => s.init)
  const settings = useSettingsStore((s) => s.settings)
  const measurementsByBatch = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const create = useMeasurementsStore((s) => s.create)
  const update = useMeasurementsStore((s) => s.update)

  // Диалог может открыться прямо из списка — справочник приборов ещё
  // мог не загрузиться (иначе предпросмотр найдёт null-прибор).
  useEffect(() => {
    if (!catalogsLoaded) void initCatalogs()
  }, [catalogsLoaded, initCatalogs])

  const last = useMemo(() => lastDensityMeasurement(measurementsByBatch), [measurementsByBatch])

  const [kind, setKind] = useState<MeasurementKind>(existing?.kind ?? 'density')
  const [rawValue, setRawValue] = useState(existing ? String(existing.rawValue) : '')
  const [unit, setUnit] = useState<'sg' | 'brix'>(
    existing?.unit ?? settings?.densityUnit ?? 'sg'
  )
  const [instrumentId, setInstrumentId] = useState<string>(
    existing?.instrumentId ?? last?.instrumentId ?? ''
  )
  const [tempC, setTempC] = useState<string>(
    existing?.tempC != null ? String(existing.tempC) : last?.tempC != null ? String(last.tempC) : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const valueRef = useRef<HTMLInputElement | null>(null)

  // Дефолты из последнего замера партии (спека 6.1.4) — в том числе когда
  // диалог открыт прямо из списка, а не из карточки.
  useEffect(() => {
    if (!existing) void loadFor(batch.id)
  }, [batch.id, existing, loadFor])

  useEffect(() => {
    if (existing || defaultsApplied || !last) return
    if (!instrumentId && last.instrumentId) setInstrumentId(last.instrumentId)
    if (!tempC && last.tempC != null) setTempC(String(last.tempC))
    setDefaultsApplied(true)
  }, [existing, defaultsApplied, last, instrumentId, tempC])

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
          measuredAtUtc: existing?.measuredAtUtc ?? toUtcIso(new Date())
        },
        buildContext(batch, instrumentId)
      )
    }
  }, [kind, rawValue, unit, instrumentId, tempC, isHydrometer, batch, existing, instruments])

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
      measuredAtUtc: existing?.measuredAtUtc ?? toUtcIso(new Date())
    }
    try {
      if (existing) {
        await update(existing.id, batch.id, input)
        onClose()
        return
      }
      await create(input)
      setSavedCount((n) => n + 1)
      setRawValue('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Замер">
      <form className="modal" onSubmit={(e) => void submit(e)}>
        <h3>{existing ? 'Правка замера' : 'Замер'}</h3>
        {savedCount > 0 ? (
          <p className="muted">Сохранено замеров за этот сеанс: {savedCount}</p>
        ) : null}

        {!existing ? (
          <label>
            Тип замера
            <select value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
              {Object.entries(KIND_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
        ) : null}

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
                      {preview.resolved.correctedSg?.toFixed(4)} SG
                    </strong>
                    {preview.resolved.correctedBrix != null
                      ? ` (Bf ${preview.resolved.correctedBrix.toFixed(2)} °Bx)`
                      : ''}
                  </p>
                  {preview.resolved.warnings.map((w) => (
                    <p key={w} className="error-text">⚠ {w}</p>
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
          <button type="submit">{existing ? 'Сохранить' : 'Сохранить (Enter)'}</button>
          {existing ? (
            <button type="button" onClick={onClose}>Отмена</button>
          ) : (
            <button type="button" onClick={onClose}>Закрыть</button>
          )}
        </div>
      </form>
    </div>
  )
}

/** Секция «Замеры» в карточке партии: хронология, след, ревизии. */
export function MeasurementsSection(props: { batch: BatchDto }): ReactElement {
  const { batch } = props
  const list = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const remove = useMeasurementsStore((s) => s.remove)
  const revisionsByMeasurement = useMeasurementsStore((s) => s.revisionsByMeasurement)
  const loadRevisions = useMeasurementsStore((s) => s.loadRevisions)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MeasurementDto | null>(null)
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
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          Замер
        </button>
      </div>

      <ul className="item-list">
        {(list ?? []).map((m) => {
          const warnings = (m.corrections as { warnings?: string[] }).warnings ?? []
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
                    ? `${m.rawValue} ${m.unit === 'brix' ? '°Bx' : 'SG'} → ${m.correctedSg?.toFixed(4)} SG`
                    : `${m.rawValue} ${m.kind === 'temperature' ? '°C' : 'pH'}`}
                  {warnings.length > 0 ? ' ⚠' : ''}
                </div>
                <div className="muted">{m.measuredAtUtc.slice(0, 16).replace('T', ' ')} UTC</div>
              </button>
              <div className="item-actions">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(m)
                    setDialogOpen(true)
                  }}
                >
                  Правка
                </button>
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
          revisions={revisionsByMeasurement[detail.id]}
          onOpenRevisions={() => void loadRevisions(detail.id)}
          onClose={() => setDetailId(null)}
        />
      ) : null}

      {dialogOpen ? (
        <MeasurementDialog
          batch={batch}
          existing={editing}
          onClose={() => {
            setDialogOpen(false)
            setEditing(null)
          }}
        />
      ) : null}

      {confirmDelete ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Удалить замер?</h3>
            <p>Снапшот замера сохранится в истории правок партии.</p>
            <div className="form-actions">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  void remove(confirmDelete, batch.id)
                  setConfirmDelete(null)
                }}
              >
                Удалить
              </button>
              <button type="button" onClick={() => setConfirmDelete(null)}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function MeasurementDetail(props: {
  measurement: MeasurementDto
  revisions?: Array<{ id: string; action: string; snapshot: unknown; revisedAtUtc: string }>
  onOpenRevisions(): void
  onClose(): void
}): ReactElement {
  const { measurement: m, revisions, onOpenRevisions, onClose } = props
  const steps = (m.corrections as { steps?: Array<{ type: string; input: number; output: number; note?: string }>; warnings?: string[] }).steps ?? []
  const warnings = (m.corrections as { warnings?: string[] }).warnings ?? []
  const instrument = useCatalogsStore((s) => s.instruments.find((i) => i.id === m.instrumentId))

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Карточка замера">
      <div className="modal">
        <h3>Замер — {KIND_LABELS[m.kind]}</h3>
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
                {m.correctedSg?.toFixed(4)} SG
                {m.correctedBrix != null ? ` (Bf ${m.correctedBrix.toFixed(2)} °Bx)` : ''}
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

        <h4>
          История правок{' '}
          <button type="button" onClick={onOpenRevisions}>Показать</button>
        </h4>
        <ul>
          {(revisions ?? []).map((r) => (
            <li key={r.id}>
              {r.action === 'update' ? 'Правка' : 'Удаление'} — {r.revisedAtUtc.slice(0, 16).replace('T', ' ')} UTC
              {' '}(
              {r.action === 'delete'
                ? `было: ${(r.snapshot as { rawValue?: number }).rawValue}`
                : `rawValue до: ${(r.snapshot as { rawValue?: number }).rawValue}`}
              )
            </li>
          ))}
          {revisions && revisions.length === 0 ? <li className="muted">Правок не было</li> : null}
        </ul>

        <div className="form-actions">
          <button type="button" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
