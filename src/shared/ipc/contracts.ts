import { z } from 'zod'

/**
 * Дескрипторы IPC-каналов: имя + zod-схемы запроса и ответа.
 * Единый источник типов для main, preload и renderer (см. design.md D3).
 */

export interface ChannelDefinition {
  readonly name: string
  readonly request: z.ZodType
  readonly response: z.ZodType
}

export function defineChannel<C extends ChannelDefinition>(channel: C): C {
  return channel
}

export const appHealthChannel = defineChannel({
  name: 'app:health',
  request: z.object({}),
  response: z.object({
    pong: z.literal(true),
    appVersion: z.string(),
    utilityEcho: z.string(),
    time: z.string()
  })
})

export const appStateGetChannel = defineChannel({
  name: 'app-state:get',
  request: z.object({ key: z.string().min(1) }),
  response: z.object({ key: z.string(), value: z.unknown().nullable() })
})

export const appStateSetChannel = defineChannel({
  name: 'app-state:set',
  request: z.object({ key: z.string().min(1), value: z.unknown() }),
  response: z.object({ ok: z.boolean() })
})

export const utilityEchoChannel = defineChannel({
  name: 'utility:echo',
  request: z.object({ message: z.string() }),
  response: z.object({ echoed: z.string() })
})

export const channels = {
  appHealth: appHealthChannel,
  appStateGet: appStateGetChannel,
  appStateSet: appStateSetChannel,
  utilityEcho: utilityEchoChannel
} as const

export type ChannelKey = keyof typeof channels

/** Тип запроса канала. */
export type ChannelRequest<K extends ChannelKey> = z.infer<
  (typeof channels)[K]['request']
>

/** Тип ответа канала. */
export type ChannelResponse<K extends ChannelKey> = z.infer<
  (typeof channels)[K]['response']
>

/**
 * Конверт результата invoke: main всегда отвечает этим объектом,
 * preload распаковывает его и превращает ошибку в исключение.
 */
export const ipcEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
])

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
