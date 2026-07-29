import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { useClipboard, COPY_FAILED_MESSAGE, COPIED_RESET_MS } from '../useClipboard.ts'

/**
 * Records what it was asked to copy, and either resolves or rejects like the real API does.
 * `behaviour` stays writable so one instance can fail and then succeed, the way a clipboard
 * does when the user grants permission after a denial.
 */
function createFakeClipboard(behaviour: 'resolve' | 'reject') {
  const state = { behaviour }
  const writes: string[] = []
  const writeText = async (text: string) => {
    writes.push(text)
    if (state.behaviour === 'reject') throw new Error('NotAllowedError')
  }
  return { writeText, writes, state }
}

// Enabled for every test, not just the one that ticks the clock: a successful copy schedules
// the 1500ms reset, and a real timer would keep the event loop alive until it fires.
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => mock.timers.reset())

test('a successful copy flips copied to true and back after the reset delay', async () => {
  const clipboard = createFakeClipboard('resolve')
  const { copied, error, copy } = useClipboard(clipboard.writeText)

  await copy('https://example.com/AAAAAA')

  assert.equal(copied.value, true)
  assert.equal(error.value, '')

  mock.timers.tick(COPIED_RESET_MS)

  assert.equal(copied.value, false)
})

// The behaviour a v1.3.0 fix introduced: before it, a clipboard rejection left the button
// doing nothing at all, with no way for the user to tell whether the copy had worked.
test('a rejected copy reports the failure and never claims success', async () => {
  const clipboard = createFakeClipboard('reject')
  const { copied, error, copy } = useClipboard(clipboard.writeText)

  await copy('https://example.com/AAAAAA')

  assert.equal(error.value, COPY_FAILED_MESSAGE)
  assert.equal(copied.value, false)
})

// Clearing happens when the button is pressed, not when the write comes back. CopyButton
// watches `error` to re-emit it, so a stale failure has to disappear on the click itself —
// asserted before awaiting, while the write is still in flight.
test('a later copy clears the earlier failure message before the write resolves', async () => {
  const clipboard = createFakeClipboard('reject')
  const { error, copy } = useClipboard(clipboard.writeText)
  await copy('https://example.com/AAAAAA')
  assert.equal(error.value, COPY_FAILED_MESSAGE, 'precondition: the first copy failed')

  const inFlight = copy('https://example.com/BBBBBB')

  assert.equal(error.value, '')
  await inFlight
  assert.equal(error.value, COPY_FAILED_MESSAGE, 'still failing, so the message comes back')
})

test('a copy that succeeds after a failure leaves no message behind', async () => {
  const clipboard = createFakeClipboard('reject')
  const { copied, error, copy } = useClipboard(clipboard.writeText)
  await copy('https://example.com/AAAAAA')

  clipboard.state.behaviour = 'resolve'
  await copy('https://example.com/BBBBBB')

  assert.equal(error.value, '')
  assert.equal(copied.value, true)
})

test('the text passed to copy is the text handed to the clipboard', async () => {
  const clipboard = createFakeClipboard('resolve')
  const { copy } = useClipboard(clipboard.writeText)

  await copy('https://example.com/AAAAAA')

  assert.deepEqual(clipboard.writes, ['https://example.com/AAAAAA'])
})
