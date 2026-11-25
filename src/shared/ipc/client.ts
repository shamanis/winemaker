import {
  channels,
  ipcEnvelopeSchema,
  type ChannelKey,
  type ChannelRequest,
  type ChannelResponse
} from './contracts'
import {
  eventContracts,
  type EventName,
  type EventPayload,
  type EventListener
} from '../events/events'
import type { WinemakerTransport } from './bridge'

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
    throw new Error(`[${envelope.error.code}] ${envelope.error.message}`)
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
    backupCompleted: (cb: EventListener<'backup:completed'>): (() => void) =>
      onEvent(transport, 'backup:completed', cb)
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
