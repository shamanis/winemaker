import { ipcMain } from 'electron'
import {
  channels,
  settingsSchema,
  type ChannelDefinition,
  type IpcEnvelope,
} from '../../shared/ipc/contracts'
import type { AppStateRepository } from '../app-state/repository'
import type { InstrumentRepository, YeastStrainRepository } from '../catalogs/repositories'
import type { BatchFull, BatchRepository } from '../batches/repository'
import type { MeasurementRepository } from '../measurements/repository'
import type { InstrumentRow, MeasurementRevisionRow, MeasurementRow, YeastStrainRow } from '../db/schema'
import type { UtilityRpc } from '../utility/spawn'
import { nowUtcIso } from '../../shared/time/utc'

export interface IpcContext {
  appVersion: string
  appState: AppStateRepository
  instruments: InstrumentRepository
  strains: YeastStrainRepository
  batches: BatchRepository
  measurements: MeasurementRepository
  utility: UtilityRpc
}

const SETTINGS_KEY = 'settings'
const DEFAULT_SETTINGS = { densityUnit: 'sg', correctionFormula: 'terrill' } as const

/**
 * Регистрирует все IPC-хендлеры с валидацией на границе (design.md D3):
 * запрос проверяется схемой до хендлера, ответ — до отправки в renderer.
 * Ошибки нормализуются в конверт {ok:false, error:{code,message}}.
 */
function handleChannel<Req, Res>(
  channel: ChannelDefinition,
  handler: (request: Req) => Promise<Res> | Res
): void {
  ipcMain.handle(
    channel.name,
    async (_event, raw): Promise<IpcEnvelope<Res>> => {
      const request = channel.request.safeParse(raw ?? {})
      if (!request.success) {
        return {
          ok: false,
          error: {
            code: 'BAD_REQUEST',
            message: request.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ')
          }
        }
      }
      try {
        const result = await handler(request.data as Req)
        const response = channel.response.safeParse(result)
        if (!response.success) {
          return {
            ok: false,
            error: { code: 'RESPONSE_INVALID', message: 'response schema mismatch' }
          }
        }
        return { ok: true, data: response.data as Res }
      } catch (error) {
        return toErrorEnvelope(error)
      }
    }
  )
}

function toErrorEnvelope(error: unknown): IpcEnvelope<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'INTERNAL', message } }
}

export function registerIpcHandlers(ctx: IpcContext): void {
  handleChannel<{}, { pong: true; appVersion: string; utilityEcho: string; time: string }>(
    channels.appHealth,
    async () => {
      const echo = await ctx.utility.echo('ping')
      return {
        pong: true,
        appVersion: ctx.appVersion,
        utilityEcho: echo.echoed,
        time: nowUtcIso()
      }
    }
  )

  handleChannel<{ key: string }, { key: string; value: unknown }>(
    channels.appStateGet,
    ({ key }) => ({ key, value: ctx.appState.get(key) })
  )

  handleChannel<{ key: string; value: unknown }, { ok: boolean }>(
    channels.appStateSet,
    ({ key, value }) => {
      ctx.appState.set(key, value)
      return { ok: true }
    }
  )

  handleChannel<{ message: string }, { echoed: string }>(channels.utilityEcho, async ({ message }) => {
    const echo = await ctx.utility.echo(message)
    return { echoed: echo.echoed }
  })

  /* Справочник приборов */
  handleChannel<{}, { items: InstrumentRow[] }>(
    channels.instrumentsList,
    () => ({ items: ctx.instruments.list() })
  )
  handleChannel<Parameters<InstrumentRepository['create']>[0], { item: InstrumentRow }>(
    channels.instrumentsCreate,
    (input) => ({ item: ctx.instruments.create(input) })
  )
  handleChannel<{ id: string; patch: Partial<Parameters<InstrumentRepository['update']>[1]> }, { item: InstrumentRow | null }>(
    channels.instrumentsUpdate,
    ({ id, patch }) => ({ item: ctx.instruments.update(id, patch) ?? null })
  )
  handleChannel<{ id: string }, { ok: boolean }>(channels.instrumentsDelete, ({ id }) => {
    ctx.instruments.delete(id)
    return { ok: true }
  })
  handleChannel<
    { instrumentId: string; refrBrix: number; hydrometerSg: number },
    { item: InstrumentRow }
  >(channels.instrumentsCalibrate, ({ instrumentId, refrBrix, hydrometerSg }) => {
    const { instrument } = ctx.instruments.calibrate(instrumentId, refrBrix, hydrometerSg)
    return { item: instrument }
  })

  /* Справочник штаммов */
  handleChannel<{}, { items: YeastStrainRow[] }>(
    channels.strainsList,
    () => ({ items: ctx.strains.list() })
  )
  handleChannel<Parameters<YeastStrainRepository['create']>[0], { item: YeastStrainRow }>(
    channels.strainsCreate,
    (input) => ({ item: ctx.strains.create(input) })
  )
  handleChannel<{ id: string; patch: Partial<Parameters<YeastStrainRepository['update']>[1]> }, { item: YeastStrainRow | null }>(
    channels.strainsUpdate,
    ({ id, patch }) => ({ item: ctx.strains.update(id, patch) ?? null })
  )
  handleChannel<{ id: string }, { ok: boolean }>(channels.strainsDelete, ({ id }) => {
    ctx.strains.delete(id)
    return { ok: true }
  })

  /* Партии */
  handleChannel<{}, { items: ReturnType<BatchRepository['listActive']> }>(
    channels.batchesList,
    () => ({ items: ctx.batches.listActive() })
  )
  handleChannel<{}, { items: ReturnType<BatchRepository['listArchived']> }>(
    channels.batchesListArchived,
    () => ({ items: ctx.batches.listArchived() })
  )
  handleChannel<Parameters<BatchRepository['create']>[0], { full: BatchFull }>(
    channels.batchesCreate,
    (input) => ({ full: ctx.batches.create(input) })
  )
  handleChannel<{ id: string }, { full: BatchFull | null }>(
    channels.batchesGet,
    ({ id }) => ({ full: ctx.batches.get(id) ?? null })
  )
  handleChannel<{ id: string; patch: Parameters<BatchRepository['update']>[1] }, { full: BatchFull | null }>(
    channels.batchesUpdate,
    ({ id, patch }) => ({ full: ctx.batches.update(id, patch) ?? null })
  )
  handleChannel<{ id: string; to: Parameters<BatchRepository['changeStatus']>[1]; atUtc?: string }, { full: BatchFull | null }>(
    channels.batchesUpdateStatus,
    ({ id, to, atUtc }) => ({ full: ctx.batches.changeStatus(id, to, atUtc) ?? null })
  )
  handleChannel<{ id: string; finalResult: Parameters<BatchRepository['archive']>[1] }, { full: BatchFull | null }>(
    channels.batchesArchive,
    ({ id, finalResult }) => ({ full: ctx.batches.archive(id, finalResult) ?? null })
  )
  handleChannel<{ id: string }, { ok: boolean }>(channels.batchesDelete, ({ id }) => {
    ctx.batches.delete(id)
    return { ok: true }
  })

  /* Замеры: коррекция выполняется в репозитории через провайдер контекста
     (createResolveContextProvider) — формула читается из настроек на сервере. */
  handleChannel<{ batchId: string }, { items: MeasurementRow[] }>(
    channels.measurementsListByBatch,
    ({ batchId }) => ({ items: ctx.measurements.listByBatch(batchId) })
  )
  handleChannel<Parameters<MeasurementRepository['create']>[0], { item: MeasurementRow }>(
    channels.measurementsCreate,
    (input) => ({ item: ctx.measurements.create(input) })
  )
  handleChannel<
    { id: string; patch: Parameters<MeasurementRepository['update']>[1] },
    { item: MeasurementRow | null }
  >(channels.measurementsUpdate, ({ id, patch }) => ({
    item: ctx.measurements.update(id, patch) ?? null
  }))
  handleChannel<{ id: string }, { ok: boolean }>(channels.measurementsDelete, ({ id }) => {
    ctx.measurements.delete(id)
    return { ok: true }
  })
  handleChannel<{ id: string }, { items: MeasurementRevisionRow[] }>(
    channels.measurementsRevisions,
    ({ id }) => ({ items: ctx.measurements.listRevisions(id) })
  )

  /* Настройки: один ключ JSON в app_state (design D4) */
  handleChannel<{}, { settings: typeof DEFAULT_SETTINGS | Record<string, unknown> }>(
    channels.settingsGet,
    () => {
      const stored = ctx.appState.get<unknown>(SETTINGS_KEY)
      const settings = settingsSchema.safeParse(stored)
      return { settings: settings.success ? settings.data : { ...DEFAULT_SETTINGS } }
    }
  )
  handleChannel<{ settings: unknown }, { ok: boolean }>(
    channels.settingsSet,
    ({ settings }) => {
      ctx.appState.set(SETTINGS_KEY, settings)
      return { ok: true }
    }
  )
}
