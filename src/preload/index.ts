import { contextBridge, ipcRenderer } from 'electron'

/**
 * Транспортный уровень моста (design.md D3): тонкий preload без
 * внешних зависимостей — sandboxed preload не может require модули.
 * Валидация payload'ов выполняется на границах: запрос и ответ —
 * zod-схемами в main и в типизированном клиенте renderer'а (shared/).
 */

const DEFAULT_TIMEOUT_MS = 10_000

async function invoke(
  channel: string,
  payload?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`IPC ${channel} timeout after ${timeoutMs}ms`)),
      timeoutMs
    )
  })
  try {
    return await Promise.race([
      ipcRenderer.invoke(channel, payload ?? {}),
      timeout
    ])
  } finally {
    clearTimeout(timer)
  }
}

function on(
  channel: string,
  listener: (payload: unknown) => void
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
    listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('winemaker', { invoke, on })

export {}
