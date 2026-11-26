import { create } from 'zustand'
import type { InstrumentDto, InstrumentInput, InstrumentType, StrainDto, StrainInput } from '@shared/ipc/contracts'
import { api } from '../api'

interface CatalogsStoreState {
  instruments: InstrumentDto[]
  strains: StrainDto[]
  loaded: boolean
  /** Подсказка новичку после первого добавления прибора (спека reference-catalogs). */
  firstInstrumentHint: boolean
  init(): Promise<void>
  createInstrument(input: InstrumentInput): Promise<InstrumentDto>
  updateInstrument(id: string, patch: Partial<InstrumentInput>): Promise<void>
  deleteInstrument(id: string): Promise<void>
  /** Калибровка по паре «рефрактометр — ареометр» (спека 2.6). */
  calibrate(id: string, refrBrix: number, hydrometerBx: number): Promise<void>
  createStrain(input: StrainInput): Promise<StrainDto>
  updateStrain(id: string, patch: Partial<StrainInput>): Promise<void>
  deleteStrain(id: string): Promise<void>
  dismissFirstInstrumentHint(): void
}

export const useCatalogsStore = create<CatalogsStoreState>((set, get) => ({
  instruments: [],
  strains: [],
  loaded: false,
  firstInstrumentHint: false,

  async init() {
    const [instruments, strains] = await Promise.all([api.instruments.list(), api.strains.list()])
    set({ instruments, strains, loaded: true })
  },

  async createInstrument(input) {
    const created = await api.instruments.create(input)
    const wasEmpty = get().instruments.length === 0
    set((s) => ({
      instruments: [...s.instruments, created],
      firstInstrumentHint: s.firstInstrumentHint || wasEmpty
    }))
    return created
  },

  async updateInstrument(id, patch) {
    const updated = await api.instruments.update(id, patch)
    if (updated) {
      set((s) => ({ instruments: s.instruments.map((i) => (i.id === id ? updated : i)) }))
    }
  },

  async deleteInstrument(id) {
    await api.instruments.remove(id)
    set((s) => ({ instruments: s.instruments.filter((i) => i.id !== id) }))
  },

  async calibrate(id, refrBrix, hydrometerBx) {
    const updated = await api.calibrate(id, refrBrix, hydrometerBx)
    set((s) => ({ instruments: s.instruments.map((i) => (i.id === id ? updated : i)) }))
  },

  async createStrain(input) {
    const created = await api.strains.create(input)
    set((s) => ({ strains: [...s.strains, created] }))
    return created
  },

  async updateStrain(id, patch) {
    const updated = await api.strains.update(id, patch)
    if (updated) {
      set((s) => ({ strains: s.strains.map((i) => (i.id === id ? updated : i)) }))
    }
  },

  async deleteStrain(id) {
    await api.strains.remove(id)
    set((s) => ({ strains: s.strains.filter((i) => i.id !== id) }))
  },

  dismissFirstInstrumentHint() {
    set({ firstInstrumentHint: false })
  }
}))

export const INSTRUMENT_TYPE_LABELS: Record<InstrumentType, string> = {
  'refractometer-atc': 'Рефрактометр с ATC',
  refractometer: 'Рефрактометр без ATC',
  hydrometer: 'Ареометр',
  other: 'Иной прибор'
}
