/**
 * Доменная ошибка (design D8): машинный ключ каталога + параметры вместо
 * готовой фразы. Текст подставляет интерфейс на текущем языке; message
 * хранит ключ — его достаточно для журналов main.
 */
export class AppError extends Error {
  readonly key: string
  readonly params?: Record<string, string | number>

  constructor(key: string, params?: Record<string, string | number>) {
    super(key)
    this.name = 'AppError'
    this.key = key
    this.params = params
  }
}

/** Поле-level issue проверки ввода из конверта IPC. */
export interface IpcErrorIssue {
  readonly path: string
  readonly key?: string
}

/** Инициалы для IpcError — форма поля error из конверта (contracts). */
export interface IpcErrorInit {
  readonly code: string
  readonly message: string
  readonly key?: string
  readonly params?: Record<string, string | number>
  readonly issues?: readonly IpcErrorIssue[]
}

/** Ошибка IPC на стороне renderer (design D8): несёт ключ каталога для показа. */
export class IpcError extends Error {
  readonly code: string
  readonly key?: string
  readonly params?: Record<string, string | number>
  readonly issues?: readonly IpcErrorIssue[]

  constructor(init: IpcErrorInit) {
    super(`[${init.code}] ${init.message}`)
    this.name = 'IpcError'
    this.code = init.code
    this.key = init.key
    this.params = init.params
    this.issues = init.issues
  }
}
