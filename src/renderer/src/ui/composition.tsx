import { useState, type FormEvent, type ReactElement } from 'react'
import type { AdditionInput, AdditionKind, StrainDto, YeastInput } from '@shared/ipc/contracts'
import { api } from '../api'
import { useCatalogsStore } from '../store/catalogs-store'
import { Modal } from './Modal'

/**
 * Редакторы состава партии (спека batch-management 1.3–1.4): дрожжи —
 * только штамм из справочника («ровно один способ»; нет в справочнике —
 * создаётся там же через модалку), и стартовые добавки.
 */

export const ADDITION_KIND_LABELS: Record<AdditionKind, string> = {
  nutrient: 'Питательные соли',
  enzyme: 'Фермент',
  so2: 'Диоксид серы',
  sugar: 'Сахар',
  acid: 'Корректировка кислотности',
  other: 'Другое'
}

const DOSE_UNITS: Array<{ value: 'g' | 'ml' | 'packet' | 'tablet'; label: string }> = [
  { value: 'g', label: 'г' },
  { value: 'ml', label: 'мл' },
  { value: 'packet', label: 'пакет' },
  { value: 'tablet', label: 'таблетка' }
]
type DoseUnit = (typeof DOSE_UNITS)[number]['value']

/** Подпись единицы дозировки для отображения (machine → человек). */
export function doseUnitLabel(u: string): string {
  return DOSE_UNITS.find((d) => d.value === u)?.label ?? u
}

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
    doseUnit: (DOSE_UNITS.some(d => d.value === y.doseUnit) ? y.doseUnit : 'g') as DoseUnit,
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
    kind: (a.kind in ADDITION_KIND_LABELS ? a.kind : 'other') as AdditionKind,
    doseAmount: a.doseAmount != null ? String(a.doseAmount) : '',
    doseUnit: (DOSE_UNITS.some(d => d.value === a.doseUnit) ? a.doseUnit : 'g') as DoseUnit,
    addedAt: a.addedAtUtc.slice(0, 10),
    notes: a.notes ?? ''
  }))
}

const isoSafe = (n: number): boolean => Number.isFinite(n) && n > 0

/** Валидация строк перед сохранением: текст ошибки или null. */
export function validateYeastRows(rows: YeastRow[]): string | null {
  for (const [i, r] of rows.entries()) {
    if (r.strainId === '') continue // пустые строки пропускаются
    if (!isoSafe(Number(r.doseAmount))) return `Дрожжи, строка ${i + 1}: укажите дозировку числом`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.addedAt)) return `Дрожжи, строка ${i + 1}: укажите дату внесения`
  }
  return null
}

export function validateAdditionRows(rows: AdditionRow[]): string | null {
  for (const [i, r] of rows.entries()) {
    if (r.name.trim() === '') continue
    if (!isoSafe(Number(r.doseAmount))) return `Добавки, строка ${i + 1}: укажите дозировку числом`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.addedAt)) return `Добавки, строка ${i + 1}: укажите время внесения`
  }
  return null
}

const NEW_STRAIN = '__new__'

/** Быстрое создание штамма из формы партии: попадает в справочник и в строку. */
function NewStrainModal(props: {
  onCreated(strain: StrainDto): void
  onClose(): void
}): ReactElement {
  const createStrain = useCatalogsStore((s) => s.createStrain)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    if (name === '') {
      setError('Укажите название штамма')
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
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="Новый штамм дрожжей" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          void submit(e)
        }}
        className="form-grid"
      >
        <label>
          Название *
          <input name="name" required placeholder="Lalvin EC-1118" />
        </label>
        <label>
          Производитель
          <input name="producer" placeholder="Lallemand" />
        </label>
        <label>
          t° мин, °C
          <input name="tempMinC" type="number" step="1" />
        </label>
        <label>
          t° макс, °C
          <input name="tempMaxC" type="number" step="1" />
        </label>
        <label>
          Толерантность к спирту, % об.
          <input name="alcoholTolerancePct" type="number" step="0.5" />
        </label>
        <label>
          Заметки
          <input name="notes" />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">Создать и выбрать</button>
          <button type="button" onClick={props.onClose}>Отмена</button>
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
  const { rows, onChange, strains } = props
  const [creatingFor, setCreatingFor] = useState<number | null>(null)
  const update = (idx: number, patch: Partial<YeastRow>): void => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  return (
    <div className="rows-editor">
      {rows.map((row, idx) => (
        <fieldset key={idx} className="row-fieldset">
          <legend>Дрожжи {rows.length > 1 ? idx + 1 : ''}</legend>
          <div className="inline-fields">
            <label>
              Штамм из справочника
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
                <option value="">— выберите штамм —</option>
                {strains.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                <option value={NEW_STRAIN}>＋ Новый штамм…</option>
              </select>
            </label>
          </div>
          <div className="inline-fields">
            <label>
              Дозировка
              <input
                value={row.doseAmount}
                onChange={(e) => update(idx, { doseAmount: e.target.value })}
                type="number"
                step="0.1"
                min="0"
              />
            </label>
            <label>
              Единицы
              <select
                value={row.doseUnit}
                onChange={(e) => update(idx, { doseUnit: e.target.value as DoseUnit })}
              >
                {DOSE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
            <label>
              Дата внесения
              <input
                value={row.addedAt}
                onChange={(e) => update(idx, { addedAt: e.target.value })}
                type="date"
              />
            </label>
            <label>
              Дата производства
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
            Убрать строку
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...rows, emptyYeastRow()])}>
        + Добавить дрожжи
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
  const { rows, onChange } = props
  const update = (idx: number, patch: Partial<AdditionRow>): void => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  return (
    <div className="rows-editor">
      {rows.map((row, idx) => (
        <fieldset key={idx} className="row-fieldset">
          <legend>Добавка {rows.length > 1 ? idx + 1 : ''}</legend>
          <div className="inline-fields">
            <label>
              Название
              <input
                value={row.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                placeholder="Диаммонийфосфат"
              />
            </label>
            <label>
              Тип
              <select
                value={row.kind}
                onChange={(e) => update(idx, { kind: e.target.value as AdditionKind })}
              >
                {Object.entries(ADDITION_KIND_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Дозировка
              <input
                value={row.doseAmount}
                onChange={(e) => update(idx, { doseAmount: e.target.value })}
                type="number"
                step="0.1"
                min="0"
              />
            </label>
            <label>
              Единицы
              <select
                value={row.doseUnit}
                onChange={(e) => update(idx, { doseUnit: e.target.value as DoseUnit })}
              >
                {DOSE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
            <label>
              Время внесения (дата)
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
            Убрать строку
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...rows, emptyAdditionRow()])}>
        + Добавить добавку
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
  const [yeastRows, setYeastRows] = useState(props.initialYeast)
  const [additionRows, setAdditionRows] = useState(props.initialAdditions)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    try {
      if (props.kind === 'yeast') {
        const err = validateYeastRows(yeastRows)
        if (err) { setError(err); return }
        setSaving(true)
        await props.onSaveYeast(yeastRowsToInput(yeastRows))
      } else {
        const err = validateAdditionRows(additionRows)
        if (err) { setError(err); return }
        setSaving(true)
        await props.onSaveAdditions(additionRowsToInput(additionRows))
      }
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
        <button type="submit" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
        <button type="button" onClick={props.onClose}>Отмена</button>
      </div>
    </form>
    </Modal>
  )
}
