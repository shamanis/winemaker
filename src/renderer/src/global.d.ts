import type { WinemakerTransport } from '@shared/ipc/bridge'

declare global {
  interface Window {
    winemaker: WinemakerTransport
  }
}

export {}
