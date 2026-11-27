import {
  channels,
  ipcEnvelopeSchema,
  type AppSettings,
  type BatchCreateInput,
  type BatchFullDto,
  type BatchStatus,
  type ChannelKey,
  type ChannelRequest,
  type ChannelResponse,
  type FinalResultDto,
  type AdditionInput,
  type InstrumentDto,
  type InstrumentInput,
  type MeasurementCreateInput,
  type MeasurementDto,
  type OperationDto,
  type OperationInput,
  type StrainDto,
  type StrainInput,
  type YeastInput
} from './contracts'
import {
  eventContracts,
  type EventName,
  type EventPayload,
  type EventListener
} from '../events/events'
import type { WinemakerTransport } from './bridge'
import { IpcError } from './errors'
import type { Language } from '../i18n/resolve-language'

/**
 * Типизированный клиент над транспортом preload (design.md D3).
 * Валидирует конверт и ответ схемой канала — zod на границе renderer'а.
 */
async function invokeChannel<K extends ChannelKey>(
  transport: WinemakerTransport,
  key: K,
  payload: ChannelRequest<K>,
  timeoutMs?: number
): Promise<ChannelResponse<K>> {
  const raw = await transport.invoke(channels[key].name, payload, timeoutMs)
  const envelope = ipcEnvelopeSchema.parse(raw)
  if (!envelope.ok) {
    // Ошибка несёт ключ каталога для показа на языке интерфейса (design D8);
    // message остаётся машинным — для журнала консоли.
    throw new IpcError(envelope.error)
  }
  return channels[key].response.parse(envelope.data) as ChannelResponse<K>
}

function onEvent<E extends EventName>(
  transport: WinemakerTransport,
  name: E,
  listener: EventListener<E>
): () => void {
  return transport.on(name, (raw) => {
    listener(eventContracts[name].parse(raw))
  })
}

function crudClient<In extends object, Dto>(
  transport: WinemakerTransport,
  keys: { list: ChannelKey; create: ChannelKey; update: ChannelKey; remove: ChannelKey }
) {
  return {
    list: async (): Promise<Dto[]> => {
      const r = await invokeChannel(transport, keys.list, {} as never)
      return (r as { items: Dto[] }).items
    },
    create: async (input: In): Promise<Dto> => {
      const r = await invokeChannel(transport, keys.create, input as never)
      return (r as { item: Dto }).item
    },
    update: async (id: string, patch: Partial<In>): Promise<Dto | null> => {
      const r = await invokeChannel(transport, keys.update, { id, patch } as never)
      return (r as { item: Dto | null }).item
    },
    remove: async (id: string): Promise<void> => {
      await invokeChannel(transport, keys.remove, { id } as never)
    }
  }
}

/** Поверхность API для renderer'а. */
export function createApiClient(transport: WinemakerTransport) {
  return {
    health: () => invokeChannel(transport, 'appHealth', {}),
    appStateGet: async (key: string): Promise<unknown> =>
      (await invokeChannel(transport, 'appStateGet', { key })).value,
    appStateSet: async (key: string, value: unknown): Promise<void> => {
      await invokeChannel(transport, 'appStateSet', { key, value })
    },
    utilityEcho: async (message: string): Promise<string> =>
      (await invokeChannel(transport, 'utilityEcho', { message })).echoed,

    instruments: crudClient<InstrumentInput, InstrumentDto>(transport, {
      list: 'instrumentsList',
      create: 'instrumentsCreate',
      update: 'instrumentsUpdate',
      remove: 'instrumentsDelete'
    }),

    strains: crudClient<StrainInput, StrainDto>(transport, {
      list: 'strainsList',
      create: 'strainsCreate',
      update: 'strainsUpdate',
      remove: 'strainsDelete'
    }),

    batches: {
      list: async (): Promise<ChannelResponse<'batchesList'>['items']> =>
        (await invokeChannel(transport, 'batchesList', {})).items,
      listArchived: async (): Promise<ChannelResponse<'batchesListArchived'>['items']> =>
        (await invokeChannel(transport, 'batchesListArchived', {})).items,
      create: async (input: BatchCreateInput): Promise<{ full: BatchFullDto }> =>
        invokeChannel(transport, 'batchesCreate', input),
      get: async (id: string): Promise<BatchFullDto | null> =>
        (await invokeChannel(transport, 'batchesGet', { id })).full,
      update: async (
        id: string,
        patch: Partial<Pick<BatchCreateInput, 'title' | 'rawMaterial' | 'style' | 'volumeLiters'>>
      ): Promise<BatchFullDto | null> =>
        (await invokeChannel(transport, 'batchesUpdate', { id, patch })).full,
      updateStatus: async (
        id: string,
        to: BatchStatus,
        atUtc?: string
      ): Promise<BatchFullDto | null> =>
        (await invokeChannel(transport, 'batchesUpdateStatus', { id, to, atUtc })).full,
      archive: async (id: string, finalResult: FinalResultDto): Promise<BatchFullDto | null> =>
        (await invokeChannel(transport, 'batchesArchive', { id, finalResult })).full,
      remove: async (id: string): Promise<void> => {
        await invokeChannel(transport, 'batchesDelete', { id })
      }
    },

    settings: {
      get: async (): Promise<{ settings: AppSettings; resolvedLanguage: Language }> =>
        invokeChannel(transport, 'settingsGet', {}),
      set: async (
        settings: AppSettings
      ): Promise<{ ok: boolean; resolvedLanguage: Language }> =>
        invokeChannel(transport, 'settingsSet', { settings })
    },

    measurements: {
      listByBatch: async (batchId: string): Promise<MeasurementDto[]> =>
        (await invokeChannel(transport, 'measurementsListByBatch', { batchId })).items,
      create: async (input: MeasurementCreateInput): Promise<MeasurementDto> =>
        (await invokeChannel(transport, 'measurementsCreate', input)).item,
      remove: async (id: string): Promise<void> => {
        await invokeChannel(transport, 'measurementsDelete', { id })
      }
    },

    calibrate: async (
      instrumentId: string,
      refrBrix: number,
      hydrometerBx: number
    ): Promise<InstrumentDto> =>
      (await invokeChannel(transport, 'instrumentsCalibrate', { instrumentId, refrBrix, hydrometerBx }))
        .item,

    operations: {
      listByBatch: async (batchId: string): Promise<OperationDto[]> =>
        (await invokeChannel(transport, 'operationsListByBatch', { batchId })).items,
      create: async (input: OperationInput): Promise<OperationDto> =>
        ((await invokeChannel(transport, 'operationsCreate', input)) as { item: OperationDto }).item,
      update: async (id: string, patch: Partial<OperationInput>): Promise<OperationDto | null> =>
        ((await invokeChannel(transport, 'operationsUpdate', { id, patch })) as { item: OperationDto | null }).item,
      remove: async (id: string): Promise<void> => {
        await invokeChannel(transport, 'operationsDelete', { id })
      }
    },

    exportBatch: async (id: string): Promise<string | null> =>
      (await invokeChannel(transport, 'batchesExport', { id })).path,

    setYeast: async (batchId: string, yeast: YeastInput[]): Promise<BatchFullDto | null> =>
      (await invokeChannel(transport, 'batchesSetYeast', { batchId, yeast })).full,
    setAdditions: async (batchId: string, additions: AdditionInput[]): Promise<BatchFullDto | null> =>
      (await invokeChannel(transport, 'batchesSetAdditions', { batchId, additions })).full,

    backupCompleted: (cb: EventListener<'backup:completed'>): (() => void) =>
      onEvent(transport, 'backup:completed', cb)
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
