import { createApiClient, type ApiClient } from '@shared/ipc/client'

/** Единственный экземпляр типизированного API для renderer'а. */
export const api: ApiClient = createApiClient(window.winemaker)
