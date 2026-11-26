import { create } from 'zustand'
import type { MeasurementCreateInput, MeasurementDto } from '@shared/ipc/contracts'
import { api } from '../api'

interface MeasurementsStoreState {
  /** Замеры по batchId (хронология). */
  byBatch: Record<string, MeasurementDto[]>
  loadFor(batchId: string): Promise<void>
  create(input: MeasurementCreateInput): Promise<MeasurementDto>
  remove(id: string, batchId: string): Promise<void>
}

export const useMeasurementsStore = create<MeasurementsStoreState>((set, get) => ({
  byBatch: {},

  async loadFor(batchId) {
    const items = await api.measurements.listByBatch(batchId)
    set((s) => ({ byBatch: { ...s.byBatch, [batchId]: items } }))
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
