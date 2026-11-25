import { ipcMain } from 'electron'
import {
  channels,
  type ChannelDefinition,
  type IpcEnvelope
} from '../../shared/ipc/contracts'
import type { AppStateRepository } from '../app-state/repository'
import type { UtilityRpc } from '../utility/spawn'
import { nowUtcIso } from '../../shared/time/utc'

export interface IpcContext {
  appVersion: string
  appState: AppStateRepository
  utility: UtilityRpc
}

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
}
