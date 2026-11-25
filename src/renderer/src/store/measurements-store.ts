import { create } from 'zustand'
import type { MeasurementCreateInput, MeasurementDto, MeasurementPatch, MeasurementRevisionDto } from '@shared/ipc/contracts'
import { api } from '../api'

interface MeasurementsStoreState {
  /** Замеры по batchId (хронология). */
  byBatch: Record<string, MeasurementDto[]>
  /** Ревизии по measurementId (для открытой карточки замера). */
  revisionsByMeasurement: Record<string, MeasurementRevisionDto[]>
  loadFor(batchId: string): Promise<void>
  loadRevisions(measurementId: string): Promise<void>
  create(input: MeasurementCreateInput): Promise<MeasurementDto>
  update(id: string, batchId: string, patch: MeasurementPatch): Promise<void>
  remove(id: string, batchId: string): Promise<void>
}

export const useMeasurementsStore = create<MeasurementsStoreState>((set, get) => ({
  byBatch: {},
  revisionsByMeasurement: {},

  async loadFor(batchId) {
    const items = await api.measurements.listByBatch(batchId)
    set((s) => ({ byBatch: { ...s.byBatch, [batchId]: items } }))
  },

  async loadRevisions(measurementId) {
    const items = await api.measurements.revisions(measurementId)
    set((s) => ({
      revisionsByMeasurement: { ...s.revisionsByMeasurement, [measurementId]: items }
    }))
  },

  async create(input) {
    const created = await api.measurements.create(input)
    const existing = get().byBatch[input.batchId] ?? []
    set((s) => ({
      byBatch: {
        ...s.byBatch,
        [input.batchId]: [...existing, created].sort((a, b) =>
          a.measuredAtUtc.localeCompare(b.measuredAtUtc)
        )
      }
    }))
    return created
  },

  async update(id, batchId, patch) {
    const updated = await api.measurements.update(id, patch)
    if (!updated) return
    set((s) => ({
      byBatch: {
        ...s.byBatch,
        [batchId]: (s.byBatch[batchId] ?? [])
          .map((m) => (m.id === id ? updated : m))
          .sort((a, b) => a.measuredAtUtc.localeCompare(b.measuredAtUtc))
      }
    }))
  },

  async remove(id, batchId) {
    await api.measurements.remove(id)
    set((s) => ({
      byBatch: { ...s.byBatch, [batchId]: (s.byBatch[batchId] ?? []).filter((m) => m.id !== id) }
    }))
  }
}))

/** Последний замер плотности партии — источник дефолтов формы (спека 6.1.4). */
export function lastDensityMeasurement(
  list: MeasurementDto[] | undefined
): MeasurementDto | null {
  if (!list) return null
  const densities = list.filter((m) => m.kind === 'density')
  return densities.at(-1) ?? null
}
