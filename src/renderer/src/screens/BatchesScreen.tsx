import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { BatchDto, BatchFullDto, BatchStatus, FinalResultDto } from '@shared/ipc/contracts'
import { batchStatusSchema } from '@shared/ipc/contracts'
import { resolveOgSg } from '@shared/calculations/density'
import {
  apparentAttenuation,
  forecastCompletion,
  formatAbv,
  formatDensity,
  hallAbv,
  MIN_POINTS,
  residualSugar
} from '@shared/calculations/analysis'
import { novotny } from '@shared/calculations/novotny'
import { invertBrixToSg } from "@shared/calculations/correction"
import { toUtcIso } from '@shared/time/utc'
import { useBatchesStore, daysFromStart } from '../store/batches-store'
import { useCatalogsStore } from '../store/catalogs-store'
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
  resolveStrainDisplay,
  CompositionDialog,
  type YeastRow,
  type AdditionRow
} from '../ui/composition'
import { api } from '../api'
import { describeError } from '../errors'
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
  const { t } = useTranslation()
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

  /** Диалог подтверждения удаления — общий для списка и карточки (ранние
   * return'ы ниже иначе его не отрисовывают, и кнопка «Удалить…» мертва). */
  const confirmDialog = confirmDelete ? (
    <ConfirmDialog
      title={t('batches.deleteTitle')}
      text={t('batches.deleteText')}
      confirmLabel={t('batches.delete')}
      onConfirm={() => {
        void remove(confirmDelete)
        setConfirmDelete(null)
      }}
      onCancel={() => setConfirmDelete(null)}
    />
  ) : null

  if (!loaded) {
    return <section className="screen"><p className="muted">{t('batches.loading')}</p></section>
  }

  if (selected) {
    return (
      <>
        <BatchCard
          full={selected}
          onBack={closeSelection}
          onDelete={() => setConfirmDelete(selected.batch.id)}
        />
        {confirmDialog}
      </>
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
        <h2>{t('batches.title')}</h2>
        <button
          type="button"
          className="btn-fab"
          title={t('batches.newBatch')}
          aria-label={t('batches.newBatch')}
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
            <h2>{t('batches.empty.title')}</h2>
            <p>
              {t('batches.empty.text')}
            </p>
            <button type="button" onClick={() => setCreating(true)}>{t('batches.newBatch')}</button>
          </div>
        </div>
      )}

      {archived.length > 0 ? (
        <>
          <h3>{t('batches.archive')}</h3>
          <BatchTable
            batches={archived}
            archived
            onOpen={(id) => void select(id)}
            onMeasure={(id) => setQuickMeasureBatchId(id)}
          />
        </>
      ) : null}

      {confirmDialog}

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
  const { t } = useTranslation()
  const { batches, archived, onOpen, onMeasure } = props
  return (
    <div className="btable-wrap">
      <table className="btable">
        <thead>
          <tr>
            <th>{t('batches.columns.name')}</th>
            <th>{t('batches.columns.status')}</th>
            <th>{t('batches.columns.createdAt')}</th>
            <th>{t('batches.columns.rawMaterial')}</th>
            <th>{t('batches.columns.og')}</th>
            <th>{t('batches.columns.abv')}</th>
            <th>{t('batches.columns.attenuation')}</th>
            <th>{t('batches.columns.residualSugar')}</th>
            <th className="actions">{t('batches.columns.actions')}</th>
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
  const { t } = useTranslation()
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
      <td><span className={`chip chip-${batch.status}`}>{t(`batches.status.${batch.status}`)}</span></td>
      <td className="num">{batch.startDateUtc.slice(0, 10)}</td>
      <td>{batch.rawMaterial}</td>
      <td className="num">{formatDensity(ogSg, unit)}</td>
      <td className="num">{formatAbv(abv, t)}</td>
      <td className="num">{attenuation != null ? `${attenuation.toFixed(1)} %` : '—'}</td>
      <td className="num">{sugar != null ? t('format.gPerL', { value: sugar.toFixed(0) }) : '—'}</td>
      <td className="actions">
        {!archived ? (
          <button
            type="button"
            title={t('batches.quickMeasure')}
            onClick={() => onMeasure(batch.id)}
          >
            {t('batches.quickMeasureBtn')}
          </button>
        ) : null}
        <button type="button" title={t('batches.open')} onClick={() => onOpen(batch.id)}>
          {t('batches.openBtn')}
        </button>
      </td>
    </tr>
  )
}

function BatchCreateForm(props: { onDone(): void; onCancel(): void }): ReactElement {
  const { onDone, onCancel } = props
  const { t } = useTranslation()
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
      setError(t('batches.startGravityRequired'))
      return
    }
    const yeastError = validateYeastRows(yeastRows, t)
    if (yeastError) { setError(yeastError); return }
    const additionsError = validateAdditionRows(additionRows, t)
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
      setError(describeError(e, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>{t('batches.create.title')}</h2>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>

      <form className="form-grid" onSubmit={(e) => void submit(e)}>
        <h3>{t('batches.create.card')}</h3>
        <label>
          {t('batches.create.field.title')}
          <input name="title" required placeholder={t('batches.create.ph.title')} />
        </label>
        <label>
          {t('batches.create.field.rawMaterial')}
          <input name="rawMaterial" required placeholder={t('batches.create.ph.rawMaterial')} />
        </label>
        <label>
          {t('batches.create.field.style')}
          <input name="style" placeholder={t('batches.create.ph.style')} />
        </label>
        <label>
          {t('batches.create.field.volume')}
          <input name="volumeLiters" type="number" step="0.1" min="0.1" />
        </label>
        <label>
          {t('batches.create.field.startDate')}
          <input
            name="startDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </label>

        <h3>{t('batches.create.section.startGravity')}</h3>
        <div className="inline-fields">
          <label>
            {t('batches.create.field.reading')} ({unit === 'brix' ? '°Bx' : 'SG'})
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
            {t('batches.create.field.units')}
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'sg' | 'brix')}>
              <option value="brix">Brix</option>
              <option value="sg">SG</option>
            </select>
          </label>
          <label>
            {t('batches.create.field.instrument')}
            <select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              <option value="">{t('batches.create.noInstrument')}</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({t(`catalogs.type.${i.type}`)})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted" aria-live="polite">
          {ogPreview
            ? `${t('batches.create.ogPreview', { sg: ogPreview.ogSg.toFixed(4) })}${
                ogPreview.correctedBrix !== null
                  ? ` ${t('batches.create.ogPreviewCorrected', { brix: ogPreview.correctedBrix.toFixed(2) })}`
                  : ''
              }`
            : t('batches.create.ogPreviewHint')}
        </p>

        <div className="inline-fields">
          <label>
            {t('batches.create.field.ph')}
            <input name="ph" type="number" step="0.01" min="2" max="7" />
          </label>
          <label>
            {t('batches.create.field.tempC')}
            <input name="tempC" type="number" step="0.1" min="-5" max="60" />
          </label>
        </div>

        <h3><Term id="ferment">{t('batches.create.section.yeast')}</Term></h3>
        <YeastRowsEditor rows={yeastRows} onChange={setYeastRows} strains={strains} />

        <h3>{t('batches.create.section.additions')}</h3>
        <AdditionRowsEditor rows={additionRows} onChange={setAdditionRows} />

        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? t('common.saving') : t('batches.create.submit')}
          </button>
          <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </form>
    </section>
  )
}

type BatchTab = 'overview' | 'measurements' | 'journal'

const BATCH_TABS: Array<{ id: BatchTab }> = [
  { id: 'overview' },
  { id: 'measurements' },
  { id: 'journal' }
]

function BatchCard(props: { full: BatchFullDto; onBack(): void; onDelete(): void }): ReactElement {
  const { full, onBack, onDelete } = props
  const { t } = useTranslation()
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
  const otherStatuses = batchStatusSchema.options.filter((s) => s !== batch.status)

  const startParams = batch.startParams

  const exportJson = async (): Promise<void> => {
    try {
      const path = await api.exportBatch(batch.id)
      setExportNote(path ? t('batches.exported', { path }) : t('batches.exportCancelled'))
    } catch (e) {
      setExportNote(describeError(e, t))
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <button type="button" onClick={onBack}>{t('batches.back')}</button>
        <h2>{batch.title}</h2>
        <span className={`chip chip-${batch.status}`}>{t(`batches.status.${batch.status}`)}</span>
      </div>

      <div className="subtabs" role="tablist" aria-label={t('batches.cardTabsAria')}>
        {BATCH_TABS.map((bt) => (
          <button
            key={bt.id}
            type="button"
            role="tab"
            aria-selected={tab === bt.id}
            className={tab === bt.id ? 'subtab active' : 'subtab'}
            onClick={() => setTab(bt.id)}
          >
            {t(`batches.tabs.${bt.id}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <>
          <div className="card-grid">
            <div className="card">
              <h3>{t('batches.create.card')}</h3>
              <dl>
                <dt>{t('batches.card.rawMaterial')}</dt><dd>{batch.rawMaterial}</dd>
                <dt>{t('batches.card.style')}</dt><dd>{batch.style ?? '—'}</dd>
                <dt>{t('batches.card.volume')}</dt><dd>{batch.volumeLiters !== null ? t('format.liters', { value: batch.volumeLiters }) : '—'}</dd>
                <dt>{t('batches.card.start')}</dt><dd>{batch.startDateUtc.slice(0, 10)}</dd>
                <dt>{t('batches.card.daysFromStart')}</dt><dd>{daysFromStart(batch.startDateUtc)}</dd>
              </dl>
            </div>

            <div className="card">
              <h3>{t('batches.card.startGravity')}</h3>
              <dl>
                <dt>{t('batches.card.rawReading')}</dt>
                <dd>
                  {startParams.gravity.raw.value} {startParams.gravity.raw.unit === 'brix' ? '°Bx' : 'SG'}
                </dd>
                <dt><Term id="og">OG (SG)</Term></dt>
                <dd>{formatDensity(startParams.gravity.ogSg, 'sg')}</dd>
                {startParams.gravity.correctedBrix != null ? (
                  <>
                    <dt>{t('batches.card.corrected')}</dt>
                    <dd>{startParams.gravity.correctedBrix.toFixed(2)} °Bx</dd>
                  </>
                ) : null}
                <dt>{t('batches.card.ph')}</dt><dd>{startParams.ph ?? '—'}</dd>
                <dt>{t('batches.card.tempC')}</dt><dd>{startParams.tempC !== null && startParams.tempC !== undefined ? `${startParams.tempC} °C` : '—'}</dd>
              </dl>
            </div>

            <CalculationsCard batch={batch} />

            <div className="card">
              <h3>{t('batches.card.yeast')}</h3>
              {full.yeast.length === 0 ? (
                <p className="muted">{t('batches.card.notAdded')}</p>
              ) : (
                <ul>
                  {full.yeast.map((y) => {
                    const strain = resolveStrainDisplay(y, strains)
                    return (
                      <li key={y.id}>
                        {strain.name}
                        {strain.producer ? ` (${strain.producer})` : ''} — {y.doseAmount} {t(`batches.doseUnit.${y.doseUnit}`)}
                      </li>
                    )
                  })}
                </ul>
              )}
              <button type="button" onClick={() => setCompositionDialog('yeast')}>
                {full.yeast.length === 0 ? t('batches.card.add') : t('batches.card.edit')}
              </button>
              <h3>{t('batches.card.additions')}</h3>
              {full.additions.length === 0 ? (
                <p className="muted">{t('batches.card.notAdded')}</p>
              ) : (
                <ul>
                  {full.additions.map((a) => (
                    <li key={a.id}>{a.name} — {a.doseAmount} {t(`batches.doseUnit.${a.doseUnit}`)}</li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setCompositionDialog('additions')}>
                {full.additions.length === 0 ? t('batches.card.add') : t('batches.card.edit')}
              </button>
            </div>

            <div className="card">
              <h3>{t('batches.card.history')}</h3>
              <ol>
                {full.history.map((h) => (
                  <li key={h.id}>
                    {t(`batches.status.${h.toStatus}`)} — {h.atUtc.slice(0, 16).replace('T', ' ')} UTC
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {batch.finalResult ? (
            <div className="card">
              <h3>{t('batches.final.title')}</h3>
              <dl>
                <dt>{t('batches.final.gravity')}</dt>
                <dd>{batch.finalResult.finalGravity ?? '—'}</dd>
                <dt>{t('batches.final.abv')}</dt>
                <dd>{formatAbv(batch.finalResult.abvPct, t)}</dd>
                <dt>{t('batches.final.notes')}</dt>
                <dd>{batch.finalResult.tastingNotes ?? '—'}</dd>
              </dl>
            </div>
          ) : null}

          <div className="form-actions">
            {!isArchived
              ? otherStatuses.map((s) => (
                  <button key={s} type="button" onClick={() => void changeStatus(batch.id, s)}>
                    → {t(`batches.status.${s}`)}
                  </button>
                ))
              : null}
            {!isArchived ? (
              <button type="button" onClick={() => setArchiving(true)}>{t('batches.archiveBtn')}</button>
            ) : null}
            <button type="button" onClick={() => void exportJson()}>{t('batches.exportBtn')}</button>
            <button type="button" className="danger" onClick={onDelete}>{t('batches.deleteBtn')}</button>
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
          title={compositionDialog === 'yeast' ? t('batches.card.yeastDialogTitle') : t('batches.card.additionsDialogTitle')}
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
  const { t } = useTranslation()
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
      <h3><Term id="abv">{t('batches.calc.title')}</Term></h3>
      <dl>
        <dt>{t('batches.calc.abvCurrent')}</dt>
        <dd>{formatAbv(abv, t)}</dd>
        <dt>{t('batches.calc.attenuation')}</dt>
        <dd>{attenuation != null ? `${attenuation.toFixed(1)} %` : '—'}</dd>
        <dt>{t('batches.calc.residualSugar')}</dt>
        <dd>{sugar != null ? t('format.gPerL', { value: sugar.toFixed(1) }) : '—'}</dd>
        <dt>{t('batches.calc.forecast')}</dt>
        <dd>
          {forecast.kind === 'range'
            ? `${forecast.fromUtc.slice(0, 10)} — ${forecast.toUtc.slice(0, 10)}`
            : t(`forecast.${forecast.reason}` as string,
                forecast.reason === 'minPoints' ? { count: MIN_POINTS } : {})}
        </dd>
      </dl>
      <p className="muted">
        {t('batches.calc.note')} ·{' '}
        {isRefractometer
          ? t('batches.calc.abvNovotny')
          : t('batches.calc.formulas')}{' '}
        · <Term id="abv">{t('batches.calc.more')}</Term>
      </p>
    </div>
  )
}

function ArchiveDialog(props: {
  onConfirm(result: FinalResultDto): void
  onCancel(): void
}): ReactElement {
  const { t } = useTranslation()
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
    <Modal title={t('batches.archiveDialog.title')} onClose={props.onCancel}>
      <form onSubmit={submit}>
        <p className="muted">{t('batches.archiveDialog.hint')}</p>
        <label>
          {t('batches.archiveDialog.finalGravity')}
          <input name="finalGravity" type="number" step="0.0001" min="0.9" max="1.2" required />
        </label>
        <label>
          {t('batches.archiveDialog.abv')}
          <input name="abvPct" type="number" step="0.1" min="0" max="25" required />
        </label>
        <label>
          {t('batches.archiveDialog.notes')}
          <textarea name="tastingNotes" rows={3} />
        </label>
      <div className="form-actions">
        <button type="submit">{t('batches.archiveDialog.submit')}</button>
        <button type="button" onClick={props.onCancel}>{t('common.cancel')}</button>
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
  const { t } = useTranslation()
  return (
    <Modal title={props.title} onClose={props.onCancel}>
      <p>{props.text}</p>
      <div className="form-actions">
        <button type="button" className="danger" onClick={props.onConfirm}>{props.confirmLabel}</button>
        <button type="button" onClick={props.onCancel}>{t('common.cancel')}</button>
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
