import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
})
