import { BrowserWindow } from 'electron'
import { eventContracts, type EventName, type EventPayload } from '../../shared/events/events'

/**
 * Типизированная отправка пуш-событий renderer'у (design.md D3):
 * payload валидируется схемой события до отправки.
 */
export function emitEvent<E extends EventName>(
  windows: BrowserWindow[],
  name: E,
  payload: EventPayload<E>
): void {
  const parsed = eventContracts[name].parse(payload)
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(name, parsed)
    }
  }
}
