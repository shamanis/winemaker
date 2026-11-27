import { useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdditionInput, AdditionKind, StrainDto, YeastInput } from '@shared/ipc/contracts'
import { additionKindSchema } from '@shared/ipc/contracts'
import type { TranslateFn } from '@shared/i18n/create-i18n'
import { api } from '../api'
import { useCatalogsStore } from '../store/catalogs-store'
import { Modal } from './Modal'
import { describeError } from '../errors'

/**
 * Редакторы состава партии (спека batch-management 1.3–1.4): дрожжи —
 * только штамм из справочника («ровно один способ»; нет в справочнике —
 * создаётся там же через модалку), и стартовые добавки.
 */

const DOSE_UNITS = ['g', 'ml', 'packet', 'tablet'] as const
type DoseUnit = (typeof DOSE_UNITS)[number]

export interface YeastRow {
  strainId: string
  doseAmount: string
  doseUnit: DoseUnit
  addedAt: string
  productionDate: string
}

export interface AdditionRow {
  name: string
  kind: AdditionKind
  doseAmount: string
  doseUnit: DoseUnit
  addedAt: string
  notes: string
}

export function emptyYeastRow(): YeastRow {
  return {
    strainId: '',
    doseAmount: '',
    doseUnit: 'g',
    addedAt: new Date().toISOString().slice(0, 10),
    productionDate: ''
  }
}

export function emptyAdditionRow(): AdditionRow {
  return {
    name: '',
    kind: 'nutrient',
    doseAmount: '',
    doseUnit: 'g',
    addedAt: new Date().toISOString().slice(0, 10),
    notes: ''
  }
}

/** Строки UI → вход IPC (даты в ISO UTC). Только штаммы из справочника. */
export function yeastRowsToInput(rows: YeastRow[]): YeastInput[] {
  return rows
    .filter((r) => r.strainId !== '')
    .map((r) => ({
      strainId: r.strainId,
      doseAmount: Number(r.doseAmount),
      doseUnit: r.doseUnit,
      addedAtUtc: `${r.addedAt}T12:00:00.000Z`,
      productionDateUtc: r.productionDate ? `${r.productionDate}T12:00:00.000Z` : null
    }))
}

export function additionRowsToInput(rows: AdditionRow[]): AdditionInput[] {
  return rows
    .filter((r) => r.name.trim() !== '')
    .map((r) => ({
      name: r.name.trim(),
      kind: r.kind,
      doseAmount: Number(r.doseAmount),
      doseUnit: r.doseUnit,
      addedAtUtc: `${r.addedAt}T12:00:00.000Z`,
      notes: r.notes.trim() || null
    }))
}

/**
 * Имя и производитель штамма для показа в партии: штамм — ссылка на
 * справочник (strain_id), поэтому актуальные имя/производитель берём из
 * каталога — переименование в справочнике отражается в существующих
 * партиях. Снапшот в записи партии нужен только когда штамм удалён из
 * справочника или вносился вручную без ссылки.
 */
export function resolveStrainDisplay(
  entry: { strainId?: string | null; strainName: string; producer?: string | null },
  strains: ReadonlyArray<{ id: string; name: string; producer?: string | null }>
): { name: string; producer: string | null } {
  const live = entry.strainId
    ? strains.find((s) => s.id === entry.strainId)
    : undefined
  if (live) return { name: live.name, producer: live.producer ?? entry.producer ?? null }
  return { name: entry.strainName, producer: entry.producer ?? null }
}

/** DTO-записи партии → строки UI (для редактирования в карточке). */
export function yeastFromDto(
  items: ReadonlyArray<{
    strainId?: string | null
    strainName: string
    producer?: string | null
    doseAmount?: number | null
    doseUnit: string
    addedAtUtc: string
    productionDateUtc?: string | null
  }>
): YeastRow[] {
  return items.map((y) => ({
    strainId: y.strainId ?? '',
    doseAmount: y.doseAmount != null ? String(y.doseAmount) : '',
    doseUnit: (DOSE_UNITS.some(d => d === y.doseUnit) ? y.doseUnit : 'g') as DoseUnit,
    addedAt: y.addedAtUtc.slice(0, 10),
    productionDate: y.productionDateUtc?.slice(0, 10) ?? ''
  }))
}

export function additionsFromDto(
  items: ReadonlyArray<{
    name: string
    kind: string
    doseAmount?: number | null
    doseUnit: string
    addedAtUtc: string
    notes?: string | null
  }>
): AdditionRow[] {
  return items.map((a) => ({
    name: a.name,
    kind: (additionKindSchema.options.includes(a.kind as AdditionKind) ? a.kind : 'other') as AdditionKind,
    doseAmount: a.doseAmount != null ? String(a.doseAmount) : '',
    doseUnit: (DOSE_UNITS.some(d => d === a.doseUnit) ? a.doseUnit : 'g') as DoseUnit,
    addedAt: a.addedAtUtc.slice(0, 10),
    notes: a.notes ?? ''
  }))
}

const isoSafe = (n: number): boolean => Number.isFinite(n) && n > 0

/** Валидация строк перед сохранением: ключ ошибки (t) или null. */
export function validateYeastRows(rows: YeastRow[], t: TranslateFn): string | null {
  for (const [i, r] of rows.entries()) {
    if (r.strainId === '') continue // пустые строки пропускаются
    if (!isoSafe(Number(r.doseAmount))) return t('composition.err.yeastDose', { row: i + 1 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.addedAt)) return t('composition.err.yeastDate', { row: i + 1 })
  }
  return null
}

export function validateAdditionRows(rows: AdditionRow[], t: TranslateFn): string | null {
  for (const [i, r] of rows.entries()) {
    if (r.name.trim() === '') continue
    if (!isoSafe(Number(r.doseAmount))) return t('composition.err.additionDose', { row: i + 1 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.addedAt)) return t('composition.err.additionDate', { row: i + 1 })
  }
  return null
}

const NEW_STRAIN = '__new__'

/** Быстрое создание штамма из формы партии: попадает в справочник и в строку. */
function NewStrainModal(props: {
  onCreated(strain: StrainDto): void
  onClose(): void
}): ReactElement {
  const { t } = useTranslation()
  const createStrain = useCatalogsStore((s) => s.createStrain)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    if (name === '') {
      setError(t('composition.newStrain.nameRequired'))
      return
    }
    const num = (key: string): number | null => {
      const raw = String(data.get(key) ?? '').trim()
      return raw ? Number(raw) : null
    }
    try {
      const created = await createStrain({
        name,
        producer: String(data.get('producer') ?? '').trim() || null,
        tempMinC: num('tempMinC'),
        tempMaxC: num('tempMaxC'),
        alcoholTolerancePct: num('alcoholTolerancePct'),
        notes: String(data.get('notes') ?? '').trim() || null
      })
      props.onCreated(created)
    } catch (e) {
      setError(describeError(e, t))
    }
  }

  return (
    <Modal title={t('composition.newStrain.title')} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          void submit(e)
        }}
        className="form-grid"
      >
        <label>
          {t('composition.newStrain.name')}
          <input name="name" required placeholder={t('composition.newStrain.namePh')} />
        </label>
        <label>
          {t('composition.newStrain.producer')}
          <input name="producer" placeholder="Lallemand" />
        </label>
        <label>
          {t('composition.newStrain.tempMin')}
          <input name="tempMinC" type="number" step="1" />
        </label>
        <label>
          {t('composition.newStrain.tempMax')}
          <input name="tempMaxC" type="number" step="1" />
        </label>
        <label>
          {t('composition.newStrain.tolerance')}
          <input name="alcoholTolerancePct" type="number" step="0.5" />
        </label>
        <label>
          {t('composition.newStrain.notes')}
          <input name="notes" />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">{t('composition.newStrain.submit')}</button>
          <button type="button" onClick={props.onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function YeastRowsEditor(props: {
  rows: YeastRow[]
  onChange(rows: YeastRow[]): void
  strains: StrainDto[]
}): ReactElement {
  const { t } = useTranslation()
  const { rows, onChange, strains } = props
  const [creatingFor, setCreatingFor] = useState<number | null>(null)
  const update = (idx: number, patch: Partial<YeastRow>): void => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  return (
    <div className="rows-editor">
      {rows.map((row, idx) => (
        <fieldset key={idx} className="row-fieldset">
          <legend>
            {t('composition.yeastRow')}
            {rows.length > 1 ? ` ${idx + 1}` : ''}
          </legend>
          <div className="inline-fields">
            <label>
              {t('composition.strainFromCatalog')}
              <select
                value={row.strainId}
                onChange={(e) => {
                  if (e.target.value === NEW_STRAIN) {
                    setCreatingFor(idx)
                    return
                  }
                  update(idx, { strainId: e.target.value })
                }}
              >
                <option value="">{t('composition.chooseStrain')}</option>
                {strains.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                <option value={NEW_STRAIN}>{t('composition.newStrainOption')}</option>
              </select>
            </label>
          </div>
          <div className="inline-fields">
            <label>
              {t('composition.dose')}
              <input
                value={row.doseAmount}
                onChange={(e) => update(idx, { doseAmount: e.target.value })}
                type="number"
                step="0.1"
                min="0"
              />
            </label>
            <label>
              {t('composition.units')}
              <select
                value={row.doseUnit}
                onChange={(e) => update(idx, { doseUnit: e.target.value as DoseUnit })}
              >
                {DOSE_UNITS.map((u) => <option key={u} value={u}>{t(`batches.doseUnit.${u}`)}</option>)}
              </select>
            </label>
            <label>
              {t('composition.addedAt')}
              <input
                value={row.addedAt}
                onChange={(e) => update(idx, { addedAt: e.target.value })}
                type="date"
              />
            </label>
            <label>
              {t('composition.productionDate')}
              <input
                value={row.productionDate}
                onChange={(e) => update(idx, { productionDate: e.target.value })}
                type="date"
              />
            </label>
          </div>
          <button
            type="button"
            className="row-remove"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
          >
            {t('composition.removeRow')}
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...rows, emptyYeastRow()])}>
        {t('composition.addYeast')}
      </button>
      {creatingFor != null ? (
        <NewStrainModal
          onCreated={(strain) => {
            update(creatingFor, { strainId: strain.id })
            setCreatingFor(null)
          }}
          onClose={() => setCreatingFor(null)}
        />
      ) : null}
    </div>
  )
}

export function AdditionRowsEditor(props: {
  rows: AdditionRow[]
  onChange(rows: AdditionRow[]): void
}): ReactElement {
  const { t } = useTranslation()
  const { rows, onChange } = props
  const update = (idx: number, patch: Partial<AdditionRow>): void => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  return (
    <div className="rows-editor">
      {rows.map((row, idx) => (
        <fieldset key={idx} className="row-fieldset">
          <legend>
            {t('composition.additionRow')}
            {rows.length > 1 ? ` ${idx + 1}` : ''}
          </legend>
          <div className="inline-fields">
            <label>
              {t('composition.name')}
              <input
                value={row.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                placeholder={t('composition.namePh')}
              />
            </label>
            <label>
              {t('composition.kind')}
              <select
                value={row.kind}
                onChange={(e) => update(idx, { kind: e.target.value as AdditionKind })}
              >
                {additionKindSchema.options.map((v) => (
                  <option key={v} value={v}>{t(`batches.additionKind.${v}`)}</option>
                ))}
              </select>
            </label>
            <label>
              {t('composition.dose')}
              <input
                value={row.doseAmount}
                onChange={(e) => update(idx, { doseAmount: e.target.value })}
                type="number"
                step="0.1"
                min="0"
              />
            </label>
            <label>
              {t('composition.units')}
              <select
                value={row.doseUnit}
                onChange={(e) => update(idx, { doseUnit: e.target.value as DoseUnit })}
              >
                {DOSE_UNITS.map((u) => <option key={u} value={u}>{t(`batches.doseUnit.${u}`)}</option>)}
              </select>
            </label>
            <label>
              {t('composition.addedAtDate')}
              <input
                value={row.addedAt}
                onChange={(e) => update(idx, { addedAt: e.target.value })}
                type="date"
              />
            </label>
          </div>
          <button
            type="button"
            className="row-remove"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
          >
            {t('composition.removeRow')}
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...rows, emptyAdditionRow()])}>
        {t('composition.addAddition')}
      </button>
    </div>
  )
}

/**
 * Диалог редактирования состава в карточке партии: дрожжи или добавки.
 */
export function CompositionDialog(props: {
  title: string
  kind: 'yeast' | 'additions'
  initialYeast: YeastRow[]
  initialAdditions: AdditionRow[]
  strains: StrainDto[]
  onClose(): void
  onSaveYeast(rows: YeastInput[]): Promise<void>
  onSaveAdditions(rows: AdditionInput[]): Promise<void>
}): ReactElement {
  const { t } = useTranslation()
  const [yeastRows, setYeastRows] = useState(props.initialYeast)
  const [additionRows, setAdditionRows] = useState(props.initialAdditions)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    try {
      if (props.kind === 'yeast') {
        const err = validateYeastRows(yeastRows, t)
        if (err) { setError(err); return }
        setSaving(true)
        await props.onSaveYeast(yeastRowsToInput(yeastRows))
      } else {
        const err = validateAdditionRows(additionRows, t)
        if (err) { setError(err); return }
        setSaving(true)
        await props.onSaveAdditions(additionRowsToInput(additionRows))
      }
      props.onClose()
    } catch (e) {
      setError(describeError(e, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={props.title} wide onClose={props.onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {props.kind === 'yeast' ? (
          <YeastRowsEditor rows={yeastRows} onChange={setYeastRows} strains={props.strains} />
        ) : (
          <AdditionRowsEditor rows={additionRows} onChange={setAdditionRows} />
        )}
        {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
        <button type="button" onClick={props.onClose}>{t('common.cancel')}</button>
      </div>
    </form>
    </Modal>
  )
}
