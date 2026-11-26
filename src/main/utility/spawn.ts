import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron'
import {
  echoRequestSchema,
  echoResponseSchema,
  type EchoResponse,
  type UtilityRequest,
  type UtilityResponse
} from '../../shared/utility/protocol'

const CALL_TIMEOUT_MS = 5_000

interface Pending {
  resolve: (value: EchoResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * RPC-клиент над MessagePort к utility process (design.md D9).
 * Тяжёлые вычисления будущих доменов пойдут по этому же протоколу.
 */
export class UtilityRpc {
  private readonly pending = new Map<string, Pending>()

  constructor(private readonly port: MessagePortMain) {
    port.on('message', (event) => {
      this.handleMessage(event.data as UtilityResponse)
    })
    port.start()
  }

  private handleMessage(message: UtilityResponse): void {
    if (message.kind === 'err') {
      this.pending.get(message.id)?.reject(new Error(message.message))
      return
    }
    const parsed = echoResponseSchema.safeParse(message.payload)
    const pending = this.pending.get(message.payload?.id ?? '')
    if (!pending || !parsed.success) return
    clearTimeout(pending.timer)
    this.pending.delete(parsed.data.id)
    pending.resolve(parsed.data)
  }

  async echo(message: string): Promise<EchoResponse> {
    const payload = echoRequestSchema.parse({ id: randomUUID(), message })
    const request: UtilityRequest = { kind: 'req', method: 'echo', payload }
    return new Promise<EchoResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.id)
        reject(new Error(`utility echo timeout after ${CALL_TIMEOUT_MS}ms`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(payload.id, { resolve, reject, timer })
      this.port.postMessage(request)
    })
  }

  dispose(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('utility rpc disposed'))
    }
    this.pending.clear()
  }
}

export interface UtilityHandle {
  rpc: UtilityRpc
  kill(): void
}

/** Порождает utility process и пробрасывает ему MessagePort. */
export function spawnUtilityUtility(modulePath: string): UtilityHandle {
  const child = utilityProcess.fork(modulePath, [], {
    serviceName: 'winemaker-utility'
  })
  const { port1, port2 } = new MessageChannelMain()
  child.postMessage('__port__', [port2])
  const rpc = new UtilityRpc(port1)
  return {
    rpc,
    kill(): void {
      rpc.dispose()
      port1.close()
      child.kill()
    }
  }
}

export function utilityModulePath(): string {
  return join(__dirname, 'utility.js')
}
