export function log(...messages: unknown[]): void {
  console.log('[uni-desktop]', ...messages)
}

export function logWarn(...messages: unknown[]): void {
  console.warn('[uni-desktop]', ...messages)
}
