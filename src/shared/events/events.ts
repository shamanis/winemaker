import { z } from 'zod'

/**
 * Типизированный контракт пуш-событий от main к renderer.
 * Расширение списка здесь автоматически типизирует emit (main) и on (renderer).
 */

export const eventContracts = {
  'backup:completed': z.object({
    at: z.string(),
    path: z.string()
  })
} as const

export type EventName = keyof typeof eventContracts

export type EventPayload<E extends EventName> = z.infer<(typeof eventContracts)[E]>

export type EventListener<E extends EventName> = (payload: EventPayload<E>) => void
