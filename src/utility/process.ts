import {
  echoRequestSchema,
  type UtilityRequest,
  type UtilityResponse
} from '../shared/utility/protocol'

/**
 * Utility process: выполняет тяжёлые вычисления вне main-процесса.
 * Сначала принимает MessagePort из transfer-list сообщения main,
 * затем обслуживает запросы по протоколу (design.md D9).
 */

/** Минимальная поверхность MessagePort, нужная протоколу. */
interface UtilityPort {
  on(
    event: 'message',
    listener: (event: { data: unknown; ports?: UtilityPort[] }) => void
  ): void
  start(): void
  postMessage(message: unknown): void
}

interface UtilityProcessGlobals {
  parentPort?: UtilityPort
}

const parentPort = (process as NodeJS.Process & UtilityProcessGlobals).parentPort

if (!parentPort) {
  throw new Error('utility process started without a parent port')
}

let channel: UtilityPort | null = null

function serveRequest(message: UtilityRequest): void {
  if (message?.kind !== 'req' || message.method !== 'echo') return

  const parsed = echoRequestSchema.safeParse(message.payload)
  if (!parsed.success) return

  const response: UtilityResponse = {
    kind: 'res',
    method: 'echo',
    payload: { id: parsed.data.id, echoed: parsed.data.message }
  }
  channel?.postMessage(response)
}

parentPort.on('message', (event) => {
  const transferred = event.ports?.[0]
  if (transferred) {
    // Main передал MessagePort — это канал для RPC.
    channel = transferred
    transferred.on('message', (portEvent) => {
      serveRequest(portEvent.data as UtilityRequest)
    })
    transferred.start()
    return
  }
  // Прочие сообщения parentPort — управляющие, пока не используются.
})

parentPort.start()
