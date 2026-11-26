import { useCallback, useSyncExternalStore } from 'react'

export function useRetryCountdown(deadline: number) {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!deadline || Date.now() >= deadline) return () => {}
      const timer = setInterval(() => {
        notify()
        if (Date.now() >= deadline) clearInterval(timer)
      }, 250)
      return () => clearInterval(timer)
    },
    [deadline],
  )
  const remaining = useCallback(
    () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
    [deadline],
  )
  return useSyncExternalStore(subscribe, remaining, () => 0)
}
