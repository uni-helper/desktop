import type { UniOptions, UniResult } from './types'

export type UniOk<T> = T & { errMsg: string }

function formatError(api: string, error: unknown): UniResult {
  if (error && typeof error === 'object' && 'errMsg' in error && typeof (error as UniResult).errMsg === 'string')
    return error as UniResult
  const message = error instanceof Error ? error.message : String(error)
  return { errMsg: `${api}:fail ${message}` }
}

/**
 * Run an API in the uni style: callback mode (`success`/`fail`/`complete`,
 * returns undefined) when any callback is given, promise mode (resolves with
 * `{ errMsg: 'api:ok', ... }`, rejects with `{ errMsg: 'api:fail ...' }`)
 * otherwise.
 */
export function invokeUniApi<T extends object>(
  api: string,
  options: UniOptions | undefined,
  run: () => Promise<T>,
): Promise<UniOk<T>> | undefined {
  const opts: UniOptions = options ?? {}
  const promise = run()
    .then((res): UniOk<T> => ({ ...res, errMsg: `${api}:ok` }))
    .catch((error: unknown): never => {
      throw formatError(api, error)
    })

  const hasCallback = typeof opts.success === 'function'
    || typeof opts.fail === 'function'
    || typeof opts.complete === 'function'

  if (!hasCallback)
    return promise

  promise.then(
    (res) => {
      opts.success?.(res)
      opts.complete?.(res)
    },
    (err) => {
      opts.fail?.(err)
      opts.complete?.(err)
    },
  )
  return undefined
}
