import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type { BatchDto, BatchStatus, OperationDto, OperationInput, OperationKind } from '@shared/ipc/contracts'
import { STATUS_LABELS } from '../store/batches-store'
import { useOperationsStore, OPERATION_KIND_LABELS } from '../store/operations-store'
import { useMeasurementsStore } from '../store/measurements-store'
import { useBatchesStore } from '../store/batches-store'

const KIND_LABELS_MEASUREMENT: Record<string, string> = {
  density: 'Плотность',
  temperature: 'Температура',
  ph: 'pH'
}

interface TimelineEntry {
  id: string
  atUtc: string
  kind: 'measurement' | 'operation' | 'status'
  label: string
  detail: string
  notes?: string | null
}

/**
 * Единый журнал партии (спека batch-journal): замеры + операции + переходы
 * статусов в одном таймлайне; CRUD операций.
 */
export function JournalSection(props: { batch: BatchDto }): ReactElement {
  const { batch } = props
  const operations = useOperationsStore((s) => s.byBatch[batch.id])
  const loadOps = useOperationsStore((s) => s.loadFor)
  const createOp = useOperationsStore((s) => s.create)
  const updateOp = useOperationsStore((s) => s.update)
  const removeOp = useOperationsStore((s) => s.remove)
  const measurements = useMeasurementsStore((s) => s.byBatch[batch.id])
  const measurementsLoaded = useMeasurementsStore((s) => s.byBatch[batch.id] !== undefined)
  const history = useBatchesStore((s) => s.selected?.history)

  const [editing, setEditing] = useState<OperationDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    void loadOps(batch.id)
  }, [batch.id, loadOps])

  // measurements-store уже загружен вкладкой Замеров; если нет — подождём его.
  useEffect(() => {
    if (!measurementsLoaded) void useMeasurementsStore.getState().loadFor(batch.id)
  }, [measurementsLoaded, batch.id])

  const timeline: TimelineEntry[] = [
    ...(measurements ?? []).map((m) => ({
      id: `m-${m.id}`,
      atUtc: m.measuredAtUtc,
      kind: 'measurement' as const,
      label: KIND_LABELS_MEASUREMENT[m.kind] ?? m.kind,
      detail:
        m.kind === 'density'
          ? `${m.rawValue} ${m.unit === 'brix' ? '°Bx' : 'SG'} → ${m.correctedSg?.toFixed(4)} SG`
          : `${m.rawValue} ${m.kind === 'temperature' ? '°C' : 'pH'}`,
      notes: m.notes
    })),
    ...(operations ?? []).map((o) => ({
      id: `o-${o.id}`,
      atUtc: o.atUtc,
      kind: 'operation' as const,
      label: OPERATION_KIND_LABELS[o.kind as OperationKind] ?? o.kind,
      detail: '',
      notes: o.notes
    })),
    ...(history ?? []).map((h) => ({
      id: `s-${h.id}`,
      atUtc: h.atUtc,
      kind: 'status' as const,
      label: 'Статус',
      detail: `${h.fromStatus ? `${STATUS_LABELS[h.fromStatus as BatchStatus]} → ` : ''}${STATUS_LABELS[h.toStatus as BatchStatus]}`
    }))
  ].sort((a, b) => b.atUtc.localeCompare(a.atUtc)) // свежие сверху

  const badgeClass = (kind: TimelineEntry['kind']): string =>
    kind === 'measurement' ? 'badge-measure' : kind === 'operation' ? 'badge-op' : 'badge-status'

  const deleteOp = (id: string): void => {
    void removeOp(id, batch.id)
    setConfirmDelete(null)
  }

  return (
    <section className="journal">
      <div className="screen-header">
        <h3>Журнал партии</h3>
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          Операция…
        </button>
      </div>

      <ul className="item-list">
        {timeline.map((e) => (
          <li key={e.id}>
            <div>
              <span className={`badge ${badgeClass(e.kind)}`}>{e.label}</span>{' '}
              {e.detail}
              {e.notes ? <div className="muted">{e.notes}</div> : null}
            </div>
            <div className="item-actions">
              {e.kind === 'operation' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing((operations ?? []).find((o) => `o-${o.id}` === e.id) ?? null)
                      setFormOpen(true)
                    }}
                  >
                    Правка
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(e.id.slice(2))}>Удалить</button>
                </>
              ) : null}
              <span className="muted">{e.atUtc.slice(0, 16).replace('T', ' ')}</span>
            </div>
          </li>
        ))}
        {timeline.length === 0 ? <li className="muted">Событий пока нет.</li> : null}
      </ul>

      {formOpen ? (
        <OperationDialog
          batch={batch}
          existing={editing}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={async (input, id) => {
            if (id) await updateOp(id, batch.id, input)
            else await createOp({ ...input, batchId: batch.id })
            setFormOpen(false)
            setEditing(null)
          }}
        />
      ) : null}

      {confirmDelete ? (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Удалить операцию?</h3>
            <div className="form-actions">
              <button type="button" className="danger" onClick={() => deleteOp(confirmDelete)}>Удалить</button>
              <button type="button" onClick={() => setConfirmDelete(null)}>Отмена</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function OperationDialog(props: {
  batch: BatchDto
  existing: OperationDto | null
  onClose(): void
  onSubmit(input: Omit<OperationInput, 'batchId'>, id?: string): Promise<void>
}): ReactElement {
  const { existing } = props
  const [kind, setKind] = useState<OperationKind>(
    (existing?.kind as OperationKind) ?? 'rack'
  )
  const [atUtc, setAtUtc] = useState(
    existing ? existing.atUtc.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    try {
      await props.onSubmit(
        {
          kind,
          atUtc: toIso(atUtc),
          notes: notes.trim() || null
        },
        existing?.id
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={(e) => void submit(e)}>
        <h3>{existing ? 'Правка операции' : 'Новая операция'}</h3>
        <label>
          Операция
          <select value={kind} onChange={(e) => setKind(e.target.value as OperationKind)}>
            {Object.entries(OPERATION_KIND_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Дата
          <input
            type="date"
            value={atUtc}
            onChange={(e) => setAtUtc(e.target.value)}
          />
        </label>
        <label>
          Заметки (наблюдения)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <button type="submit">Сохранить</button>
          <button type="button" onClick={props.onClose}>Отмена</button>
        </div>
      </form>
    </div>
  )
}

function toIso(dateStr: string): string {
  return dateStr ? `${dateStr}T12:00:00.000Z` : new Date().toISOString()
}
