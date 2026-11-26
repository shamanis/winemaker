import { z } from 'zod'

/**
 * Протокол обмена main <-> utility process через MessagePort (design.md D9).
 * Сообщения ходят в конверте; ответы сопоставляются запросам по `id`.
 */

export const echoRequestSchema = z.object({
  id: z.string(),
  message: z.string()
})

export const echoResponseSchema = z.object({
  id: z.string(),
  echoed: z.string()
})

export type EchoRequest = z.infer<typeof echoRequestSchema>
export type EchoResponse = z.infer<typeof echoResponseSchema>

export type UtilityRequest =
  | { kind: 'req'; method: 'echo'; payload: EchoRequest }

export type UtilityResponse =
  | { kind: 'res'; method: 'echo'; payload: EchoResponse }
  | { kind: 'err'; method: string; id: string; message: string }
