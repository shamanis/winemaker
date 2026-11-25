import { create } from 'zustand'
import type { OperationDto, OperationInput, OperationKind } from '@shared/ipc/contracts'
import { api } from '../api'

interface OperationsStoreState {
  byBatch: Record<string, OperationDto[]>
  loadFor(batchId: string): Promise<void>
  create(input: OperationInput): Promise<OperationDto>
  update(id: string, batchId: string, patch: Partial<OperationInput>): Promise<void>
  remove(id: string, batchId: string): Promise<void>
}

export const useOperationsStore = create<OperationsStoreState>((set, get) => ({
  byBatch: {},

  async loadFor(batchId) {
    const items = await api.operations.listByBatch(batchId)
    set((s) => ({ byBatch: { ...s.byBatch, [batchId]: items } }))
  },

  async create(input) {
    const created = await api.operations.create(input)
    const existing = get().byBatch[input.batchId] ?? []
    set((s) => ({
      byBatch: {
        ...s.byBatch,
        [input.batchId]: [...existing, created].sort((a, b) => a.atUtc.localeCompare(b.atUtc))
      }
    }))
    return created
  },

  async update(id, batchId, patch) {
    const updated = await api.operations.update(id, patch)
    if (!updated) return
    set((s) => ({
      byBatch: {
        ...s.byBatch,
        [batchId]: (s.byBatch[batchId] ?? [])
          .map((o) => (o.id === id ? updated : o))
          .sort((a, b) => a.atUtc.localeCompare(b.atUtc))
      }
    }))
  },

  async remove(id, batchId) {
    await api.operations.remove(id)
    set((s) => ({
      byBatch: { ...s.byBatch, [batchId]: (s.byBatch[batchId] ?? []).filter((o) => o.id !== id) }
    }))
  }
}))

export const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  rack: 'Снятие с осадка',
  transfer: 'Переливка',
  sugar: 'Внесение сахара',
  acid: 'Корректировка кислотности',
  nutrient: 'Подкормка дрожжей',
  fining: 'Оклейка',
  bottling: 'Розлив',
  other: 'Другая операция'
}
