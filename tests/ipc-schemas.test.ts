import { describe, expect, it } from 'vitest'
import {
  appHealthChannel,
  appStateGetChannel,
  appStateSetChannel,
  ipcEnvelopeSchema,
  utilityEchoChannel
} from '../src/shared/ipc/contracts'

describe('zod-схемы IPC-каналов', () => {
  it('app:health принимает корректный ответ и отклоняет мусор', () => {
    const ok = appHealthChannel.response.safeParse({
      pong: true,
      appVersion: '0.1.0',
      utilityEcho: 'ping',
      time: '2026-01-01T00:00:00.000Z'
    })
    expect(ok.success).toBe(true)

    const bad = appHealthChannel.response.safeParse({ pong: 'yes' })
    expect(bad.success).toBe(false)
  })

  it('app-state:get требует непустой ключ', () => {
    expect(appStateGetChannel.request.safeParse({ key: 'theme' }).success).toBe(true)
    expect(appStateGetChannel.request.safeParse({ key: '' }).success).toBe(false)
    expect(appStateGetChannel.request.safeParse({}).success).toBe(false)
  })

  it('app-state:set принимает произвольное значение', () => {
    expect(
      appStateSetChannel.request.safeParse({ key: 'theme', value: 'dark' }).success
    ).toBe(true)
    expect(
      appStateSetChannel.request.safeParse({ key: 'bounds', value: { w: 4 } }).success
    ).toBe(true)
  })

  it('utility:echo проверяет сообщение', () => {
    expect(utilityEchoChannel.request.safeParse({ message: 'ping' }).success).toBe(true)
    expect(utilityEchoChannel.request.safeParse({ message: 42 }).success).toBe(false)
  })

  it('конверт результата различается по ok', () => {
    expect(ipcEnvelopeSchema.parse({ ok: true, data: 1 })).toEqual({
      ok: true,
      data: 1
    })
    expect(
      ipcEnvelopeSchema.parse({ ok: false, error: { code: 'X', message: 'y' } }).ok
    ).toBe(false)
    expect(ipcEnvelopeSchema.safeParse({ ok: true }).success).toBe(false)
  })
})
