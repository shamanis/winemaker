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
import { novotny } from '@shared/calculations/novotny'
import { invertBrixToSg } from "@shared/calculations/correction"
import { toUtcIso } from '@shared/time/utc'
import { useBatchesStore, STATUS_LABELS, daysFromStart } from '../store/batches-store'
import { useCatalogsStore, INSTRUMENT_TYPE_LABELS } from '../store/catalogs-store'
import { useSettingsStore } from '../store/settings-store'
import { useMeasurementsStore, lastDensityMeasurement } from '../store/measurements-store'
import {
  YeastRowsEditor,
  AdditionRowsEditor,
  yeastRowsToInput,
  additionRowsToInput,
  validateYeastRows,
  validateAdditionRows,
  emptyYeastRow,
  emptyAdditionRow,
  yeastFromDto,
  additionsFromDto,
  doseUnitLabel,
  CompositionDialog,
  type YeastRow,
  type AdditionRow
} from '../ui/composition'
import { api } from '../api'
import {
  MeasurementsSection,
  MeasurementDialog,
  MeasurementDetailModal
} from './MeasurementsUi'
import { DensityChart } from './DensityChart'
import { JournalSection } from './JournalSection'
import { Term } from '../ui/Term'
import { Modal } from '../ui/Modal'

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
        <button
          type="button"
          className="btn-fab"
          title="Новая партия"
          aria-label="Новая партия"
          onClick={() => setCreating(true)}
        >
          +
        </button>
      </div>

      {active.length > 0 ? (
        <BatchTable
          batches={active}
          archived={false}
          onOpen={(id) => void select(id)}
          onMeasure={(id) => setQuickMeasureBatchId(id)}
        />
      ) : (
        /* Нет партий: приглашение по центру области (ui-shell 7.2.1) */
        <div className="empty-screen">
          <div className="empty-card">
            <h2>Поставьте первую партию</h2>
            <p>
              Замеры, операции и заметки будут собираться в единый журнал
              этой партии.
            </p>
            <button type="button" onClick={() => setCreating(true)}>Новая партия</button>
          </div>
        </div>
      )}

      {archived.length > 0 ? (
        <>
          <h3>Архив</h3>
          <BatchTable
            batches={archived}
            archived
            onOpen={(id) => void select(id)}
            onMeasure={(id) => setQuickMeasureBatchId(id)}
          />
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

/** Таблица партий: Название, Статус, Дата, Сырьё, OG, Крепость, Сбраживание, Сахар, Действия. */
function BatchTable(props: {
  batches: BatchDto[]
  archived: boolean
  onOpen(id: string): void
  onMeasure(id: string): void
}): ReactElement {
  const { batches, archived, onOpen, onMeasure } = props
  return (
    <div className="btable-wrap">
      <table className="btable">
        <thead>
          <tr>
            <th>Название</th>
            <th>Статус</th>
            <th>Дата создания</th>
            <th>Сырьё</th>
            <th>OG</th>
            <th>Крепость</th>
            <th>Сбраживание</th>
            <th>Остаточный сахар</th>
            <th className="actions">Действия</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <BatchTableRow
              key={batch.id}
              batch={batch}
              archived={archived}
              onOpen={onOpen}
              onMeasure={onMeasure}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Строка таблицы: подгружает замеры партии и считает колонки аналитики. */
function BatchTableRow(props: {
  batch: BatchDto
  archived: boolean
  onOpen(id: string): void
  onMeasure(id: string): void
}): ReactElement {
  const { batch, archived, onOpen, onMeasure } = props
  const list = useMeasurementsStore((s) => s.byBatch[batch.id])
  const loadFor = useMeasurementsStore((s) => s.loadFor)
  const unit = useSettingsStore((s) => s.settings?.densityUnit ?? 'sg')

  useEffect(() => {
    void loadFor(batch.id)
  }, [batch.id, loadFor])

  const ogSg = batch.startParams.gravity.ogSg
  const last = lastDensityMeasurement(list)
  const fg = last?.correctedSg ?? null
  const abv =
    archived && batch.finalResult?.abvPct != null
      ? batch.finalResult.abvPct
      : ogSg != null && fg != null
        ? hallAbv(ogSg, fg)
        : null
  const attenuation = ogSg != null && fg != null ? apparentAttenuation(ogSg, fg) : null
  const sugar = ogSg != null && fg != null ? residualSugar(ogSg, fg) : null

  return (
    <tr>
      <td><strong>{batch.title}</strong></td>
      <td><span className={`chip chip-${batch.status}`}>{STATUS_LABELS[batch.status]}</span></td>
      <td className="num">{batch.startDateUtc.slice(0, 10)}</td>
      <td>{batch.rawMaterial}</td>
      <td className="num">{formatDensity(ogSg, unit)}</td>
      <td className="num">{formatAbv(abv)}</td>
      <td className="num">{attenuation != null ? `${attenuation.toFixed(1)} %` : '—'}</td>
      <td className="num">{sugar != null ? `${sugar.toFixed(0)} г/л` : '—'}</td>
      <td className="actions">
        {!archived ? (
          <button
            type="button"
            title="Быстрый замер плотности"
            onClick={() => onMeasure(batch.id)}
          >
            +Замер
          </button>
        ) : null}
        <button type="button" title="Открыть партию" onClick={() => onOpen(batch.id)}>
          Обзор
        </button>
      </td>
    </tr>
  )
}

function BatchCreateForm(props: { onDone(): void; onCancel(): void }): ReactElement {
  const { onDone, onCancel } = props
  const instruments = useCatalogsStore((s) => s.instruments)
  const strains = useCatalogsStore((s) => s.strains)
  const settings = useSettingsStore((s) => s.settings)
  const initCatalogs = useCatalogsStore((s) => s.init)
  const initSettings = useSettingsStore((s) => s.init)
  const create = useBatchesStore((s) => s.create)

  const [unit, setUnit] = useState<'sg' | 'brix'>(settings?.densityUnit ?? 'sg')
  const [gravityValue, setGravityValue] = useState('')
  const [instrumentId, setInstrumentId] = useState<string>('')
  const [yeastRows, setYeastRows] = useState<YeastRow[]>([emptyYeastRow()])
  const [additionRows, setAdditionRows] = useState<AdditionRow[]>([])
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
            calibrationOffsetBx: instrument.calibrationOffsetBx ?? null
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
    const yeastError = validateYeastRows(yeastRows)
    if (yeastError) { setError(yeastError); return }
    const additionsError = validateAdditionRows(additionRows)
    if (additionsError) { setError(additionsError); return }
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
        yeast: yeastRowsToInput(yeastRows),
        additions: additionRowsToInput(additionRows)
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

        <h3><Term id="ferment">Дрожжи</Term></h3>
        <YeastRowsEditor rows={yeastRows} onChange={setYeastRows} strains={strains} />

        <h3>Стартовые добавки</h3>
        <AdditionRowsEditor rows={additionRows} onChange={setAdditionRows} />

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
  const [compositionDialog, setCompositionDialog] = useState<'yeast' | 'additions' | null>(null)
  const setYeast = useBatchesStore((s) => s.setYeast)
  const setAdditions = useBatchesStore((s) => s.setAdditions)
  const strains = useCatalogsStore((s) => s.strains)
  const initCatalogs = useCatalogsStore((s) => s.init)

  useEffect(() => {
    void initCatalogs()
  }, [initCatalogs])

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
                      {y.producer ? ` (${y.producer})` : ''} — {y.doseAmount} {doseUnitLabel(y.doseUnit)}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setCompositionDialog('yeast')}>
                {full.yeast.length === 0 ? 'Внести…' : 'Изменить…'}
              </button>
              <h3>Добавки</h3>
              {full.additions.length === 0 ? (
                <p className="muted">Не внесены</p>
              ) : (
                <ul>
                  {full.additions.map((a) => (
                    <li key={a.id}>{a.name} — {a.doseAmount} {doseUnitLabel(a.doseUnit)}</li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setCompositionDialog('additions')}>
                {full.additions.length === 0 ? 'Внести…' : 'Изменить…'}
              </button>
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

      {compositionDialog ? (
        <CompositionDialog
          title={compositionDialog === 'yeast' ? 'Дрожжи партии' : 'Стартовые добавки'}
          kind={compositionDialog}
          initialYeast={yeastFromDto(full.yeast)}
          initialAdditions={additionsFromDto(full.additions)}
          strains={strains}
          onClose={() => setCompositionDialog(null)}
          onSaveYeast={async (rows) => { await setYeast(batch.id, rows) }}
          onSaveAdditions={async (rows) => { await setAdditions(batch.id, rows) }}
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
  const instruments = useCatalogsStore((s) => s.instruments)

  const ogSg = batch.startParams.gravity.ogSg
  const last = lastDensityMeasurement(list)
  const fg = last?.correctedSg ?? null

  // Крепость: если последний замер — рефрактометр, берём ABV из
  // двухкомпонентной модели (docs/refractometer.md, «бесплатно» из той же
  // системы уравнений); иначе — Hall по паре OG–FG.
  const lastInstrument = last?.instrumentId
    ? instruments.find((i) => i.id === last.instrumentId)
    : null
  const isRefractometer =
    lastInstrument?.type.startsWith('refractometer') ?? false
  const abv = useMemo(() => {
    if (ogSg == null || fg == null) return null
    if (isRefractometer && last) {
      const b0 =
        batch.startParams.gravity.correctedBrix ?? invertBrixToSg(ogSg)
      const r = last.rawValue * (lastInstrument?.wcf ?? 1)
      return novotny(r, b0).abvPct
    }
    return hallAbv(ogSg, fg)
  }, [ogSg, fg, isRefractometer, last, batch, lastInstrument])

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
        Расчёты по скорректированным значениям ·{' '}
        {isRefractometer
          ? 'крепость — модель Новотного'
          : 'формулы: Hall, Баллинг'}{' '}
        · <Term id="abv">подробнее в Справке</Term>
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
    <Modal title="Архивировать партию" onClose={props.onCancel}>
      <form onSubmit={submit}>
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
    </Modal>
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
    <Modal title={props.title} onClose={props.onCancel}>
      <p>{props.text}</p>
      <div className="form-actions">
        <button type="button" className="danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
        <button type="button" onClick={props.onCancel}>Отмена</button>
      </div>
    </Modal>
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
