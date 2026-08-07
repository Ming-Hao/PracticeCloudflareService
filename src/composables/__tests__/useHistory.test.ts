import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHistoryStore, VERIFIER_PLAINTEXT, type HistoryDeps, type HistoryEntry } from '../useHistory.ts'
import { decrypt, deriveKey, encrypt, PBKDF2_ITERATIONS, SALT_LENGTH } from '../../utils/crypto.ts'
import { RECORD_VERSION, type EncryptedRecord, type IdentityRecord } from '../../utils/historyDb.ts'
// Shared with historyDb.contract.test.ts, which runs the same assertions against this fake
// and the real historyDb — that is what keeps the tests below describing real behaviour.
import { createFakeDb } from '../../utils/__tests__/fakeHistoryDb.ts'

/** Fake fetch that returns queued status codes in call order. */
function createFakeFetch(statusQueue: number[]): { fetch: typeof globalThis.fetch; state: { callCount: number } } {
  const state = { callCount: 0 }
  const fetch = (async () => {
    const status = statusQueue[state.callCount]
    state.callCount++
    if (status === undefined) throw new Error('createFakeFetch: no more queued responses')
    return { ok: status < 400, status } as Response
  }) as typeof globalThis.fetch
  return { fetch, state }
}

function makeEntry(short_code: string): HistoryEntry {
  return {
    short_code,
    target_url: `https://example.com/${short_code}`,
    delete_token: `token-${short_code}`,
    created_at: new Date().toISOString(),
  }
}

interface SeededIdentity {
  id: string
  key: CryptoKey
}

/** Mirrors unlockIdentity: finds the identity `password` unlocks, creating it if absent. */
async function identityFor(identities: IdentityRecord[], password: string): Promise<SeededIdentity> {
  for (const identity of identities) {
    const key = await deriveKey(password, identity.salt, identity.iterations)
    if ((await decrypt(identity.verifier.iv, identity.verifier.ciphertext, key)) === VERIFIER_PLAINTEXT) {
      return { id: identity.id, key }
    }
  }
  const id = crypto.randomUUID()
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  identities.push({ id, salt, iterations: PBKDF2_ITERATIONS, verifier: await encrypt(VERIFIER_PLAINTEXT, key) })
  return { id, key }
}

/** Builds an encrypted record the way saveToLocal would, for seeding loadFromLocal tests. */
async function encryptEntryForTest(
  entry: HistoryEntry,
  password: string,
  identities: IdentityRecord[],
): Promise<EncryptedRecord> {
  const identity = await identityFor(identities, password)
  const { iv, ciphertext } = await encrypt(entry, identity.key)
  return { id: crypto.randomUUID(), version: RECORD_VERSION, identityId: identity.id, iv, ciphertext }
}

function shortCodesOf(entries: { short_code: string }[]): string[] {
  return entries.map((e) => e.short_code).sort()
}

function createStore(statusQueue: number[] = []) {
  const { deps: dbDeps, records, identities } = createFakeDb()
  const fakeFetch = createFakeFetch(statusQueue)
  const deps: HistoryDeps = { ...dbDeps, fetch: fakeFetch.fetch }
  return { store: createHistoryStore(deps), records, identities, fakeFetch }
}

// --- saveToLocal ---

test('saveToLocal: fresh identity moves the entry from sessionList into savedList', async () => {
  const { store } = createStore()
  const entryA = makeEntry('AAAAAA')
  store.addToSessionList(entryA)

  await store.saveToLocal(entryA, { password: 'pw1' })

  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA'])
  assert.equal(store.sessionList.value.length, 0)
})

test('saveToLocal: saving again with the same password accumulates onto savedList', async () => {
  const { store } = createStore()
  const entryA = makeEntry('AAAAAA')
  const entryB = makeEntry('BBBBBB')
  await store.saveToLocal(entryA, { password: 'pw1' })

  store.addToSessionList(entryB)
  await store.saveToLocal(entryB, { password: 'pw1' })

  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA', 'BBBBBB'])
})

test('saveToLocal: saving with a different password drops the previous identity from savedList', async () => {
  const { store } = createStore()
  const entryA = makeEntry('AAAAAA')
  const entryB = makeEntry('BBBBBB')
  await store.saveToLocal(entryA, { password: 'pw1' })

  store.addToSessionList(entryB)
  await store.saveToLocal(entryB, { password: 'pw2' })

  assert.equal(store.currentIdentity.value, 'pw2')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['BBBBBB'])
})

test('saveToLocal: reusing a password reuses its identity instead of creating a second one', async () => {
  const { store, identities } = createStore()
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })
  await store.saveToLocal(makeEntry('BBBBBB'), { password: 'pw2' })

  await store.saveToLocal(makeEntry('CCCCCC'), { password: 'pw1' })

  assert.equal(identities.length, 2)
})

test('saveToLocal: records are tagged with the identity of the password they were saved under', async () => {
  const { store, records, identities } = createStore()
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })
  await store.saveToLocal(makeEntry('BBBBBB'), { password: 'pw2' })

  const identityIds = records.map((r) => r.identityId)
  assert.deepEqual(identityIds, identities.map((i) => i.id))
})

test('saveToLocal: records are stamped with the current record version', async () => {
  const { store, records } = createStore()

  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  assert.equal(records[0]?.version, RECORD_VERSION)
})

test('saveToLocal: no password and no currentIdentity throws', async () => {
  const { store } = createStore()

  await assert.rejects(() => store.saveToLocal(makeEntry('AAAAAA')))
})

test('saveToLocal: with previousRecordId, the old entry is dropped from savedList and the new one added', async () => {
  const { store } = createStore()
  const { recordId: recordId1 } = await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  const { recordId: recordId2 } = await store.saveToLocal(makeEntry('AAAAAA'), { previousRecordId: recordId1 })

  assert.notEqual(recordId1, recordId2)
  assert.deepEqual(
    store.savedList.value.map((e) => e.recordId),
    [recordId2],
  )
})

test('saveToLocal: the previousRecordId IndexedDB record is not auto-deleted', async () => {
  const { store, records } = createStore()
  const { recordId: recordId1 } = await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  await store.saveToLocal(makeEntry('AAAAAA'), { previousRecordId: recordId1 })

  assert.ok(records.some((r) => r.id === recordId1))
})

// --- loadFromLocal ---

test('loadFromLocal: only returns records belonging to the identity the password unlocks', async () => {
  const { store, records, identities } = createStore()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1', identities))
  records.push(await encryptEntryForTest(makeEntry('CCCCCC'), 'pw2', identities))

  const success = await store.loadFromLocal('pw1')

  assert.equal(success, true)
  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA'])
})

test('loadFromLocal: a password matching no identity returns false and leaves state untouched', async () => {
  const { store, records, identities } = createStore()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1', identities))

  const success = await store.loadFromLocal('wrong-password')

  assert.equal(success, false)
  assert.equal(store.currentIdentity.value, null)
  assert.equal(store.savedList.value.length, 0)
})

// An identity with no records is not a wrong password: it happens after clearAll, which
// deletes the records but keeps the identity. Returning false would tell the user their
// password matched nothing, when the truthful answer is that the identity is empty.
test('loadFromLocal: an identity holding no records still unlocks, with an empty savedList', async () => {
  const { store, identities } = createStore()
  await identityFor(identities, 'pw1')

  const success = await store.loadFromLocal('pw1')

  assert.equal(success, true)
  assert.equal(store.currentIdentity.value, 'pw1')
  assert.equal(store.savedList.value.length, 0)
})

test('loadFromLocal: reloading the current identity replaces savedList with the DB state, not a merge', async () => {
  const { store, records, identities } = createStore()
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  // A record saved under the same password elsewhere (e.g. a previous session)
  // that this store's in-memory savedList doesn't know about yet.
  records.push(await encryptEntryForTest(makeEntry('BBBBBB'), 'pw1', identities))

  await store.loadFromLocal('pw1')

  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA', 'BBBBBB'])
})

test('loadFromLocal: switching to another identity replaces savedList rather than merging', async () => {
  const { store, records, identities } = createStore()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1', identities))
  records.push(await encryptEntryForTest(makeEntry('CCCCCC'), 'pw2', identities))
  await store.loadFromLocal('pw1')

  await store.loadFromLocal('pw2')

  assert.equal(store.currentIdentity.value, 'pw2')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['CCCCCC'])
})

// --- badgeCount ---

test('badgeCount: with no currentIdentity, only sessionList is counted', () => {
  const { store } = createStore()
  store.addToSessionList(makeEntry('AAAAAA'))
  store.addToSessionList(makeEntry('BBBBBB'))

  assert.equal(store.currentIdentity.value, null)
  assert.equal(store.badgeCount.value, 2)
})

test('badgeCount: with a currentIdentity, it is the sum of both lists', async () => {
  const { store } = createStore()
  store.addToSessionList(makeEntry('BBBBBB'))
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  assert.equal(store.badgeCount.value, 2)
})

// --- deleteSessionItem / deleteSavedItem ---

test('deleteSessionItem: server returns 200 removes the entry from sessionList', async () => {
  const { store } = createStore([200])
  const entry = makeEntry('AAAAAA')
  store.addToSessionList(entry)

  await store.deleteSessionItem(entry)

  assert.equal(store.sessionList.value.length, 0)
})

test('deleteSessionItem: server returns 404 still removes the entry (treated as already gone)', async () => {
  const { store } = createStore([404])
  const entry = makeEntry('AAAAAA')
  store.addToSessionList(entry)

  await store.deleteSessionItem(entry)

  assert.equal(store.sessionList.value.length, 0)
})

test('deleteSessionItem: server returns 403 throws and leaves sessionList unchanged', async () => {
  const { store } = createStore([403])
  const entry = makeEntry('AAAAAA')
  store.addToSessionList(entry)

  await assert.rejects(() => store.deleteSessionItem(entry))
  assert.equal(store.sessionList.value.length, 1)
})

test('deleteSavedItem: success removes both the IndexedDB record and the savedList entry', async () => {
  const { store, records } = createStore([200])
  const { recordId } = await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  await store.deleteSavedItem({ ...makeEntry('AAAAAA'), recordId })

  assert.equal(store.savedList.value.length, 0)
  assert.equal(records.length, 0)
})

test('deleteSavedItem: server returns 403 throws and the IndexedDB record is still present', async () => {
  const { store, records } = createStore([403])
  const { recordId } = await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  await assert.rejects(() => store.deleteSavedItem({ ...makeEntry('AAAAAA'), recordId }))

  assert.equal(records.length, 1)
})

// --- removeStaleLocalOnly ---

test('removeStaleLocalOnly: given a SavedEntry, removes it via the IndexedDB branch', async () => {
  const { store, records } = createStore()
  const { recordId } = await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  store.removeStaleLocalOnly({ ...makeEntry('AAAAAA'), recordId })

  assert.equal(store.savedList.value.length, 0)
  assert.equal(records.length, 0)
})

// A failing deleteRecord must not surface as an unhandled rejection: the caller (onConfirmStale
// in HistoryItem.vue) is not async, so the composable catches and logs instead of dropping it.
// The synchronous filter still runs, so the UI clears even though the record survives in storage.
test('removeStaleLocalOnly: a rejected deleteRecord is caught and logged, not left unhandled', async (t) => {
  const errors: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args)
  })

  const { deps: dbDeps } = createFakeDb({ failDeleteRecord: true })
  const fakeFetch = createFakeFetch([])
  const store = createHistoryStore({ ...dbDeps, fetch: fakeFetch.fetch })

  store.savedList.value = [{ ...makeEntry('AAAAAA'), recordId: 'rec-1' }]
  store.removeStaleLocalOnly({ ...makeEntry('AAAAAA'), recordId: 'rec-1' })

  // Synchronous branch: the list is cleared before the rejection settles.
  assert.equal(store.savedList.value.length, 0)

  // Let the rejected deleteRecord promise settle so the .catch runs.
  await Promise.resolve()
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]?.[0]), /Failed to remove stale history record/)
})

test('removeStaleLocalOnly: given a HistoryEntry, only touches sessionList and never calls fetch', () => {
  const { store, fakeFetch } = createStore()
  const entry = makeEntry('AAAAAA')
  store.addToSessionList(entry)

  store.removeStaleLocalOnly(entry)

  assert.equal(store.sessionList.value.length, 0)
  assert.equal(fakeFetch.state.callCount, 0)
})

// --- clearAll ---

// The everything-succeeds path, which is what actually happens almost every time. The
// partial-failure test below cannot stand in for it: clearAll collects the succeeded
// entries into two Sets and filters each list once at the end, and with a failure present
// that filtering is never seen doing the whole job. sessionList in particular is empty in
// every other clearAll test, so `purgedShortCodes` has only ever been an empty Set applied
// to an empty array — executed, and counted as covered, without being exercised.
test('clearAll: with both lists populated and every delete succeeding, both lists end up empty', async () => {
  const { store } = createStore([200, 200, 200, 200])
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })
  await store.saveToLocal(makeEntry('BBBBBB'))
  store.addToSessionList(makeEntry('CCCCCC'))
  store.addToSessionList(makeEntry('DDDDDD'))

  const result = await store.clearAll()

  assert.equal(result.failed, 0)
  assert.deepEqual(store.savedList.value, [])
  assert.deepEqual(store.sessionList.value, [])
})

test('clearAll: the IndexedDB records behind savedList are deleted too', async () => {
  const { store, records } = createStore([200, 200])
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })
  await store.saveToLocal(makeEntry('BBBBBB'))
  assert.equal(records.length, 2, 'precondition: both saves reached the database')

  await store.clearAll()

  assert.deepEqual(records, [])
})

test('clearAll: one entry failing with 403 still deletes the rest and reports a failure count', async () => {
  const { store } = createStore([200, 403, 200])
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })
  await store.saveToLocal(makeEntry('BBBBBB'))
  await store.saveToLocal(makeEntry('CCCCCC'))

  const result = await store.clearAll()

  assert.equal(result?.failed, 1)
  assert.deepEqual(
    store.savedList.value.map((e) => e.short_code),
    ['BBBBBB'],
  )
})
