import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from 'vue'
import {
  createHistoryStore,
  historyStoreKey,
  useHistory,
  type HistoryDeps,
  type HistoryEntry,
  type HistoryStore,
} from '../useHistory.ts'
import { createFakeDb } from '../../utils/__tests__/fakeHistoryDb.ts'

/** A store with no reachable network or IndexedDB — nothing here should touch either. */
function createFakeStore(): HistoryStore {
  const { deps: dbDeps } = createFakeDb()
  const deps: HistoryDeps = {
    ...dbDeps,
    fetch: (() => {
      throw new Error('createFakeStore: fetch is not expected in injection tests')
    }) as typeof globalThis.fetch,
  }
  return createHistoryStore(deps)
}

function makeEntry(short_code: string): HistoryEntry {
  return {
    short_code,
    target_url: `https://example.com/${short_code}`,
    delete_token: `token-${short_code}`,
    created_at: new Date().toISOString(),
  }
}

/**
 * Resolves `useHistory()` the way a component setup would. `runWithContext` is what makes
 * `inject` resolvable without a DOM or a mounted component, so these tests need no runner.
 */
function withApp<T>(provided: HistoryStore | null, fn: () => T): T {
  const app = createApp({})
  if (provided) app.provide(historyStoreKey, provided)
  return app.runWithContext(fn)
}

test('with no provider, useHistory resolves to the module singleton', () => {
  const first = withApp(null, () => useHistory())
  const second = withApp(null, () => useHistory())

  // Separate app contexts, same store: this is what production relies on, where nothing
  // ever provides and every component has to see the same session data.
  assert.equal(first, second)
  assert.notEqual(first, createFakeStore())
})

test('a provided store replaces the singleton', () => {
  const fake = createFakeStore()

  const resolved = withApp(fake, () => useHistory())

  assert.equal(resolved, fake)
  assert.notEqual(resolved, withApp(null, () => useHistory()))
})

test('separately provided stores do not share session state', () => {
  const first = createFakeStore()
  const second = createFakeStore()

  withApp(first, () => useHistory()).addToSessionList(makeEntry('AAAAAA'))

  assert.deepEqual(withApp(second, () => useHistory()).sessionList.value, [])
  assert.equal(withApp(first, () => useHistory()).sessionList.value.length, 1)
})

test('outside any app context, useHistory still resolves to the singleton', () => {
  // Vue's inject() returns undefined — not the default — when there is neither a component
  // nor an app context, despite a type signature that says otherwise. Without the fallback
  // in useHistory this returns undefined and every destructuring call site throws.
  const realWarn = console.warn
  console.warn = () => {}
  try {
    assert.equal(useHistory(), withApp(null, () => useHistory()))
  } finally {
    console.warn = realWarn
  }
})
