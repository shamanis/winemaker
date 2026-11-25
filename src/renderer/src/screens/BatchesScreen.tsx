import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import type { BatchDto, BatchFullDto, BatchStatus, FinalResultDto, MeasurementDto } from '@shared/ipc/contracts'
import { resolveOgSg } from '@shared/calculations/density'
import {
  apparentAttenuation,
  forecastCompletion,
  formatAbv,
  formatDensity,
  hallAbv,
  residualSugar
} from '@shared/calculations/analysis'
import { toUtcIso } from '@shared/time/utc'
import { useBatchesStore, STATUS_LABELS, daysFromStart } from '../store/batches-store'
import { useCatalogsStore, INSTRUMENT_TYPE_LABELS } from '../store/catalogs-store'
import { useSettingsStore } from '../store/settings-store'
import { useMeasurementsStore, lastDensityMeasurement } from '../store/measurements-store'
import { api } from '../api'
import {
  MeasurementsSection,
  MeasurementDialog,
  MeasurementDetailModal
} from './MeasurementsUi'
import { DensityChart } from './DensityChart'
import { JournalSection } from './JournalSection'
import { Term } from '../ui/Term'

/**
 * Экран партий (спека batch-management): список активных и архивных,
 * создание с вычислением OG в SG при сохранении (design D7), жизненный
 * цикл статусов, архивация с итогом, подтверждение удаления.
 */
export function BatchesScreen(): ReactElement {
  const active = useBatchesStore((s) => s.active)
  const archived = useBatchesStore((s) => s.archived)
  const selected = useBatchesStore((s) => s.selected)
  const loaded = useBatchesStore((s) => s.loaded)
  const init = useBatchesStore((s) => s.init)
  const select = useBatchesStore((s) => s.select)
  const closeSelection = useBatchesStore((s) => s.closeSelection)
  const remove = useBatchesStore((s) => s.remove)

  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  /** Партия для быстрого ввода замера со списка (≤3 действий, спека 6.1.1). */
  const [quickMeasureBatchId, setQuickMeasureBatchId] = useState<string | null>(null)

  useEffect(() => {
    void init()
  }, [init])

  if (!loaded) {
    return <section className="screen"><p className="muted">Загрузка партий…</p></section>
  }

  if (selected) {
    return (
      <BatchCard
        full={selected}
        onBack={closeSelection}
        onDelete={() => setConfirmDelete(selected.batch.id)}
      />
    )
  }

  if (creating) {
    return <BatchCreateForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
  }

  const quickMeasureBatch = quickMeasureBatchId
    ? [...active, ...archived].find((b) => b.id === quickMeasureBatchId) ?? null
    : null

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Партии</h2>
        <button type="button" onClick={() => setCreating(true)}>Новая партия</button>
      </div>

      <ul className="item-list">
        {active.map((batch) => (
          <li key={batch.id}>
            <button type="button" className="item-open" onClick={() => void select(batch.id)}>
              <div>
                <strong>{batch.title}</strong> — {STATUS_LABELS[batch.status]}
              </div>
              <div className="muted">
                <BatchListDensity batch={batch} /> · {daysFromStart(batch.startDateUtc)} дн. от постановки
              </div>
            </button>
            <div className="item-actions">
              <button
                type="button"
                title="Быстрый замер плотности"
                onClick={() => setQuickMeasureBatchId(batch.id)}
              >
                Замер
              </button>
            </div>
          </li>
        ))}
        {active.length === 0 ? (
          <li className="empty-line">
            <strong>Поставьте первую партию</strong>
            <p>Замеры, операции и заметки будут собираться в единый журнал этой партии.</p>
            <button type="button" onClick={() => setCreating(true)}>Новая партия</button>
          </li>
        ) : null}
      </ul>

      {archived.length > 0 ? (
        <>
          <h3>Архив</h3>
          <ul className="item-list">
            {archived.map((batch) => (
              <li key={batch.id}>
                <button type="button" className="item-open" onClick={() => void select(batch.id)}>
                  <div>
                    <strong>{batch.title}</strong> — {STATUS_LABELS[batch.status]}
                  </div>
                  <div className="muted">
                    {batch.finalResult?.abvPct != null ? `${batch.finalResult.abvPct} % об. · ` : ''}
                    {daysFromStart(batch.startDateUtc)} дн. от постановки
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Удалить партию?"
          text="Партия, её дрожжи, добавки и история статусов будут удалены безвозвратно."
          confirmLabel="Удалить"
          onConfirm={() => {
            void remove(confirmDelete)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}

      {quickMeasureBatch ? (
        <MeasurementDialog
          batch={quickMeasureBatch}
          onClose={() => setQuickMeasureBatchId(null)}
        />
      ) : null}
    </section>
  )
}

/** Текущая плотность из кэша замеров; «—» пока замеров нет. */
function BatchListDensity(props: { batch: BatchDto }): ReactElement {
  const { batch } = props
  const list = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const unit = useSettingsStore((s) => s.settings?.densityUnit ?? 'sg')

  useEffect(() => {
    void loadFor(batch.id)
  }, [batch.id, loadFor])

  const last = lastDensityMeasurement(list)
  return <span>Плотность: {formatDensity(last?.correctedSg, unit)}</span>
}

function BatchCreateForm(props: { onDone(): void; onCancel(): void }): ReactElement {
  const { onDone, onCancel } = props
  const instruments = useCatalogsStore((s) => s.instruments)
  const settings = useSettingsStore((s) => s.settings)
  const initCatalogs = useCatalogsStore((s) => s.init)
  const initSettings = useSettingsStore((s) => s.init)
  const create = useBatchesStore((s) => s.create)

  const [unit, setUnit] = useState<'sg' | 'brix'>(settings?.densityUnit ?? 'sg')
  const [gravityValue, setGravityValue] = useState('')
  const [instrumentId, setInstrumentId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void initCatalogs()
    void initSettings()
  }, [initCatalogs, initSettings])

  const instrument = instruments.find((i) => i.id === instrumentId) ?? null
  const ogPreview = useMemo(() => {
    const value = Number(gravityValue)
    if (!Number.isFinite(value) || gravityValue.trim() === '') return null
    if (unit === 'brix' && (value < 0 || value > 80)) return null
    if (unit === 'sg' && (value < 0.9 || value > 1.2)) return null
    return resolveOgSg(
      { value, unit },
      instrument
        ? {
            type: instrument.type,
            wcf: instrument.wcf ?? null,
            calibrationOffsetSg: instrument.calibrationOffsetSg ?? null
          }
        : null
    )
  }, [gravityValue, unit, instrument])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const gravityRaw = Number(gravityValue)
    if (!Number.isFinite(gravityRaw) || gravityValue.trim() === '') {
      setError('Укажите начальную плотность')
      return
    }
    setSubmitting(true)
    try {
      const num = (key: string): number | null => {
        const raw = String(form.get(key) ?? '').trim()
        return raw ? Number(raw) : null
      }
      const dateInput = String(form.get('startDate') ?? '')
      await create({
        title: String(form.get('title') ?? '').trim(),
        rawMaterial: String(form.get('rawMaterial') ?? '').trim(),
        style: String(form.get('style') ?? '').trim() || null,
        volumeLiters: num('volumeLiters'),
        startDateUtc: dateInput ? toUtcIso(new Date(`${dateInput}T12:00:00.000Z`)) : toUtcIso(new Date()),
        startParams: {
          gravity: { raw: { value: gravityRaw, unit, instrumentId: instrumentId || null } },
          ph: num('ph'),
          tempC: num('tempC')
        },
        yeast: [],
        additions: []
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Новая партия</h2>
        <button type="button" onClick={onCancel}>Отмена</button>
      </div>

      <form className="form-grid" onSubmit={(e) => void submit(e)}>
        <h3>Карточка</h3>
        <label>
          Название партии
          <input name="title" required placeholder="Изабелла 2026" />
        </label>
        <label>
          Сырьё (сорт)
          <input name="rawMaterial" required placeholder="Виноград Изабелла" />
        </label>
        <label>
          Планируемый стиль
          <input name="style" placeholder="полусухое красное" />
        </label>
        <label>
          Объём сусла, л
          <input name="volumeLiters" type="number" step="0.1" min="0.1" />
        </label>
        <label>
          Дата постановки
          <input
            name="startDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </label>

        <h3>Начальная плотность</h3>
        <div className="inline-fields">
          <label>
            Показание ({unit === 'brix' ? '°Bx' : 'SG'})
            <input
              name="gravity"
              type="number"
              step="0.001"
              required
              value={gravityValue}
              onChange={(e) => setGravityValue(e.target.value)}
            />
          </label>
          <label>
            Единицы
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'sg' | 'brix')}>
              <option value="brix">Brix</option>
              <option value="sg">SG</option>
            </select>
          </label>
          <label>
            Прибор
            <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              <option value="">Без прибора</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({INSTRUMENT_TYPE_LABELS[i.type]})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted" aria-live="polite">
          {ogPreview
            ? `OG будет сохранён в SG: ${ogPreview.ogSg.toFixed(4)}${
                ogPreview.correctedBrix !== null
                  ? ` (скорректированное показание: ${ogPreview.correctedBrix.toFixed(2)} °Bx)`
                  : ''
              }`
            : 'Введите показание — OG в SG рассчитается автоматически при сохранении.'}
        </p>

        <div className="inline-fields">
          <label>
            pH сусла
            <input name="ph" type="number" step="0.01" min="2" max="7" />
          </label>
          <label>
            Температура, °C
            <input name="tempC" type="number" step="0.1" min="-5" max="60" />
          </label>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? 'Сохранение…' : 'Поставить партию'}
          </button>
          <button type="button" onClick={onCancel}>Отмена</button>
        </div>
      </form>
    </section>
  )
}

type BatchTab = 'overview' | 'measurements' | 'journal'

const BATCH_TABS: Array<{ id: BatchTab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'measurements', label: 'Замеры' },
  { id: 'journal', label: 'Журнал' }
]

function BatchCard(props: { full: BatchFullDto; onBack(): void; onDelete(): void }): ReactElement {
  const { full, onBack, onDelete } = props
  const { batch } = full
  const changeStatus = useBatchesStore((s) => s.changeStatus)
  const archive = useBatchesStore((s) => s.archive)

  const [tab, setTab] = useState<BatchTab>('overview')
  const [archiving, setArchiving] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  const isArchived = batch.status === 'archived'
  const otherStatuses = (Object.keys(STATUS_LABELS) as BatchStatus[]).filter(
    (s) => s !== batch.status
  )

  const startParams = batch.startParams

  const exportJson = async (): Promise<void> => {
    try {
      const path = await api.exportBatch(batch.id)
      setExportNote(path ? `Экспортировано: ${path}` : 'Экспорт отменён')
    } catch (e) {
      setExportNote(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <button type="button" onClick={onBack}>← К списку</button>
        <h2>{batch.title}</h2>
        <span className={`chip chip-${batch.status}`}>{STATUS_LABELS[batch.status]}</span>
      </div>

      <div className="subtabs" role="tablist" aria-label="Разделы партии">
        {BATCH_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'subtab active' : 'subtab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          <div className="card-grid">
            <div className="card">
              <h3>Карточка</h3>
              <dl>
                <dt>Сырьё</dt><dd>{batch.rawMaterial}</dd>
                <dt>Стиль</dt><dd>{batch.style ?? '—'}</dd>
                <dt>Объём</dt><dd>{batch.volumeLiters !== null ? `${batch.volumeLiters} л` : '—'}</dd>
                <dt>Постановка</dt><dd>{batch.startDateUtc.slice(0, 10)}</dd>
                <dt>Дней от постановки</dt><dd>{daysFromStart(batch.startDateUtc)}</dd>
              </dl>
            </div>

            <div className="card">
              <h3>Стартовые параметры</h3>
              <dl>
                <dt>Сырое показание</dt>
                <dd>
                  {startParams.gravity.raw.value} {startParams.gravity.raw.unit === 'brix' ? '°Bx' : 'SG'}
                </dd>
                <dt><Term id="og">OG (SG)</Term></dt>
                <dd>{formatDensity(startParams.gravity.ogSg, 'sg')}</dd>
                {startParams.gravity.correctedBrix != null ? (
                  <>
                    <dt>Скорректировано</dt>
                    <dd>{startParams.gravity.correctedBrix.toFixed(2)} °Bx</dd>
                  </>
                ) : null}
                <dt>pH</dt><dd>{startParams.ph ?? '—'}</dd>
                <dt>Температура</dt><dd>{startParams.tempC !== null && startParams.tempC !== undefined ? `${startParams.tempC} °C` : '—'}</dd>
              </dl>
            </div>

            <CalculationsCard batch={batch} />

            <div className="card">
              <h3>Дрожжи</h3>
              {full.yeast.length === 0 ? (
                <p className="muted">Не внесены</p>
              ) : (
                <ul>
                  {full.yeast.map((y) => (
                    <li key={y.id}>
                      {y.strainName}
                      {y.producer ? ` (${y.producer})` : ''} — {y.doseAmount} {y.doseUnit}
                    </li>
                  ))}
                </ul>
              )}
              <h3>Добавки</h3>
              {full.additions.length === 0 ? (
                <p className="muted">Не внесены</p>
              ) : (
                <ul>
                  {full.additions.map((a) => (
                    <li key={a.id}>{a.name} — {a.doseAmount} {a.doseUnit}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <h3>История статусов</h3>
              <ol>
                {full.history.map((h) => (
                  <li key={h.id}>
                    {STATUS_LABELS[h.toStatus]} — {h.atUtc.slice(0, 16).replace('T', ' ')} UTC
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {batch.finalResult ? (
            <div className="card">
              <h3>Итоговые характеристики</h3>
              <dl>
                <dt>Финальная плотность</dt>
                <dd>{batch.finalResult.finalGravity ?? '—'}</dd>
                <dt>Крепость</dt>
                <dd>{formatAbv(batch.finalResult.abvPct)}</dd>
                <dt>Органолептика</dt>
                <dd>{batch.finalResult.tastingNotes ?? '—'}</dd>
              </dl>
            </div>
          ) : null}

          <div className="form-actions">
            {!isArchived
              ? otherStatuses.map((s) => (
                  <button key={s} type="button" onClick={() => void changeStatus(batch.id, s)}>
                    → {STATUS_LABELS[s]}
                  </button>
                ))
              : null}
            {!isArchived ? (
              <button type="button" onClick={() => setArchiving(true)}>Архивировать…</button>
            ) : null}
            <button type="button" onClick={() => void exportJson()}>Экспорт JSON…</button>
            <button type="button" className="danger" onClick={onDelete}>Удалить…</button>
          </div>
          {exportNote ? <p className="muted">{exportNote}</p> : null}
        </>
      ) : null}

      {tab === 'measurements' ? (
        <MeasurementsTab batch={batch} />
      ) : null}

      {tab === 'journal' ? <JournalSection batch={batch} /> : null}

      {archiving ? (
        <ArchiveDialog
          onConfirm={(result: FinalResultDto) => {
            void archive(batch.id, result)
            setArchiving(false)
          }}
          onCancel={() => setArchiving(false)}
        />
      ) : null}
    </section>
  )
}

/** Блок «Расчёты»: только по скорректированным значениям (спека fermentation-calculations). */
function CalculationsCard(props: { batch: BatchDto }): ReactElement {
  const { batch } = props
  const list = useMeasurementsStore((s) => s.byBatch[batch.id])
  const unit = useSettingsStore((s) => s.settings?.densityUnit ?? 'sg')

  const ogSg = batch.startParams.gravity.ogSg
  const last = lastDensityMeasurement(list)
  const fg = last?.correctedSg ?? null

  const abv = ogSg != null && fg != null ? hallAbv(ogSg, fg) : null
  const attenuation = ogSg != null && fg != null ? apparentAttenuation(ogSg, fg) : null
  const sugar = ogSg != null && fg != null ? residualSugar(ogSg, fg) : null
  const forecast = useMemo(
    () =>
      forecastCompletion(
        (list ?? [])
          .filter((m) => m.kind === 'density' && m.correctedSg != null)
          .map((m) => ({ atUtc: m.measuredAtUtc, sg: m.correctedSg as number }))
      ),
    [list]
  )

  return (
    <div className="card">
      <h3><Term id="abv">Расчёты</Term></h3>
      <dl>
        <dt>Крепость (текущая)</dt>
        <dd>{formatAbv(abv)}</dd>
        <dt>Сбраживание</dt>
        <dd>{attenuation != null ? `${attenuation.toFixed(1)} %` : '—'}</dd>
        <dt>Остаточный сахар</dt>
        <dd>{sugar != null ? `${sugar.toFixed(1)} г/л` : '—'}</dd>
        <dt>Прогноз завершения</dt>
        <dd>
          {forecast.kind === 'range'
            ? `${forecast.fromUtc.slice(0, 10)} — ${forecast.toUtc.slice(0, 10)}`
            : forecast.message}
        </dd>
      </dl>
      <p className="muted">
        Расчёты по скорректированным значениям · формулы: Hall, Баллинг ·{' '}
        <Term id="abv">подробнее в Справке</Term>
      </p>
    </div>
  )
}

function ArchiveDialog(props: {
  onConfirm(result: FinalResultDto): void
  onCancel(): void
}): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const num = (key: string): number | null => {
      const raw = String(form.get(key) ?? '').trim()
      return raw ? Number(raw) : null
    }
    props.onConfirm({
      finalGravity: num('finalGravity'),
      abvPct: num('abvPct'),
      tastingNotes: String(form.get('tastingNotes') ?? '').trim() || null
    })
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Архивация партии">
      <form className="modal" onSubmit={submit}>
        <h3>Архивировать партию</h3>
        <p className="muted">Укажите итоговые характеристики — они сохранятся вместе с историей.</p>
        <label>
          Финальная плотность (SG)
          <input name="finalGravity" type="number" step="0.0001" min="0.9" max="1.2" required />
        </label>
        <label>
          Крепость, % об.
          <input name="abvPct" type="number" step="0.1" min="0" max="25" required />
        </label>
        <label>
          Органолептические заметки
          <textarea name="tastingNotes" rows={3} />
        </label>
        <div className="form-actions">
          <button type="submit">Архивировать</button>
          <button type="button" onClick={props.onCancel}>Отмена</button>
        </div>
      </form>
    </div>
  )
}

function ConfirmDialog(props: {
  title: string
  text: string
  confirmLabel: string
  onConfirm(): void
  onCancel(): void
}): ReactElement {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={props.title}>
      <div className="modal">
        <h3>{props.title}</h3>
        <p>{props.text}</p>
        <div className="form-actions">
          <button type="button" className="danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
          <button type="button" onClick={props.onCancel}>Отмена</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Вкладка «Замеры»: график динамики + список замеров; клик по точке
 * графика открывает карточку замера (спека density-chart).
 */
function MeasurementsTab(props: { batch: BatchDto }): ReactElement {
  const { batch } = props
  const list = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const [chartOpenId, setChartOpenId] = useState<string | null>(null)

  useEffect(() => {
    void loadFor(batch.id)
  }, [batch.id, loadFor])

  const chartMeasurement = chartOpenId
    ? (list ?? []).find((m) => m.id === chartOpenId) ?? null
    : null

  return (
    <>
      <DensityChart measurements={list ?? []} onOpen={setChartOpenId} />
      <MeasurementsSection batch={batch} />
      {chartMeasurement ? (
        <MeasurementDetailModal
          measurement={chartMeasurement}
          onClose={() => setChartOpenId(null)}
        />
      ) : null}
    </>
  )
}
