import type { AppStateRepository } from '../app-state/repository'
import type { InstrumentRepository } from '../catalogs/repositories'
import type { BatchRepository } from '../batches/repository'
import { settingsSchema } from '../../shared/ipc/contracts'
import type { PipelineContext } from '../../shared/calculations/pipeline'
import type { ResolveContextProvider } from './repository'

const SETTINGS_KEY = 'settings'

/**
 * Провайдер контекста коррекции для MeasurementRepository (design D4):
 * прибор — из справочника, формула — из настроек (сервер не доверяет
 * renderer'у), старт партии — из startParams.
 */
export function createResolveContextProvider(deps: {
  appState: AppStateRepository
  instruments: InstrumentRepository
  batches: BatchRepository
}): ResolveContextProvider {
  return (batchId, instrumentId) => {
    const batch = deps.batches.get(batchId)
    if (!batch) throw new Error('Batch not found')
    const instrument = instrumentId ? deps.instruments.get(instrumentId) : undefined
    const stored = deps.appState.get<unknown>(SETTINGS_KEY)
    const settings = settingsSchema.safeParse(stored)
    const startParams = batch.batch.startParams as {
      gravity: {
        raw: { value: number; unit: 'sg' | 'brix' }
        correctedBrix?: number | null
        ogSg: number
      }
    }
    const ctx: PipelineContext = {
      instrument: instrument
        ? {
            type: instrument.type,
            wcf: instrument.wcf,
            calibrationOffsetBx: instrument.calibrationOffsetBx,
            calibrationTempC: instrument.calibrationTempC,
            hasCalibrationPair: instrument.calibrationPair != null
          }
        : null,
      correctionFormula: settings.success ? settings.data.correctionFormula : 'auto',
      startRawGravity: startParams.gravity.raw,
      startCorrectedBrix: startParams.gravity.correctedBrix ?? null,
      startOgSg: startParams.gravity.ogSg,
      batchStartDateUtc: batch.batch.startDateUtc
    }
    return ctx
  }
}
