import { create } from 'zustand'
import type { BatchDto, BatchFullDto, BatchStatus, FinalResultDto } from '@shared/ipc/contracts'
import { api } from '../api'

interface BatchesStoreState {
  active: BatchDto[]
  archived: BatchDto[]
  selected: BatchFullDto | null
  loaded: boolean
  init(): Promise<void>
  select(id: string): Promise<void>
  closeSelection(): void
  create(input: Parameters<typeof api.batches.create>[0]): Promise<BatchFullDto>
  update(id: string, patch: Parameters<typeof api.batches.update>[1]): Promise<void>
  changeStatus(id: string, to: BatchStatus): Promise<void>
  archive(id: string, finalResult: FinalResultDto): Promise<void>
  remove(id: string): Promise<void>
}

export const useBatchesStore = create<BatchesStoreState>((set, get) => ({
  active: [],
  archived: [],
  selected: null,
  loaded: false,

  async init() {
    const [active, archived] = await Promise.all([api.batches.list(), api.batches.listArchived()])
    set({ active, archived, loaded: true })
  },

  async select(id) {
    const full = await api.batches.get(id)
    set({ selected: full })
  },

  closeSelection() {
    set({ selected: null })
  },

  async create(input) {
    const { full } = await api.batches.create(input)
    await get().init()
    set({ selected: full })
    return full
  },

  async update(id, patch) {
    await api.batches.update(id, patch)
    await get().init()
    const full = await api.batches.get(id)
    set({ selected: full })
  },

  async changeStatus(id, to) {
    await api.batches.updateStatus(id, to)
    await get().init()
    set({ selected: await api.batches.get(id) })
  },

  async archive(id, finalResult) {
    await api.batches.archive(id, finalResult)
    await get().init()
    set({ selected: await api.batches.get(id) })
  },

  async remove(id) {
    await api.batches.remove(id)
    if (get().selected?.batch.id === id) set({ selected: null })
    await get().init()
  }
}))

/** Подпись статуса партии (спека batch-management, 6.2.2). */
export const STATUS_LABELS: Record<BatchStatus, string> = {
  fermenting: 'Брожение',
  'slow-fermenting': 'Дображивание',
  aging: 'Выдержка',
  bottling: 'Розлив',
  archived: 'Архив'
}

/** Число полных дней от даты постановки. */
export function daysFromStart(startDateUtc: string): number {
  const start = Date.parse(startDateUtc)
  if (!Number.isFinite(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000))
}
