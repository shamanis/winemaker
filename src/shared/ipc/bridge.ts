/**
 * Транспортный контракт, который preload выставляет в renderer.
 * Низкоуровневый: имена каналов строками, payload — unknown;
 * типизацию и валидацию добавляет клиент (ipc/client.ts).
 */
export interface WinemakerTransport {
  invoke(channel: string, payload?: unknown, timeoutMs?: number): Promise<unknown>
  on(channel: string, listener: (payload: unknown) => void): () => void
}
