import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
})

// jsdom does not implement the native dialog's modal behavior. Real-browser QA
// verifies focus trapping and Escape; these shims expose its open state in tests.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
}
