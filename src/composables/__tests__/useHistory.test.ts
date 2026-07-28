import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHistoryStore, type HistoryDbDeps, type HistoryDeps, type HistoryEntry } from '../useHistory.ts'
import { deriveKey, encrypt, SALT_LENGTH } from '../../utils/crypto.ts'
import type { EncryptedRecord } from '../../utils/historyDb.ts'

function createFakeDb(): { deps: HistoryDbDeps; records: EncryptedRecord[] } {
  const records: EncryptedRecord[] = []
  return {
    records,
    deps: {
      async putRecord(record) {
        records.push(record)
      },
      async getAllRecords() {
        return [...records]
      },
      async deleteRecord(id) {
        const index = records.findIndex((r) => r.id === id)
        if (index !== -1) records.splice(index, 1)
      },
    },
  }
}

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

/** Builds an encrypted record the way saveToLocal would, for seeding loadFromLocal tests. */
async function encryptEntryForTest(entry: HistoryEntry, password: string): Promise<EncryptedRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await deriveKey(password, salt)
  const { iv, ciphertext } = await encrypt(entry, key)
  return { id: crypto.randomUUID(), salt, iv, ciphertext }
}

function shortCodesOf(entries: { short_code: string }[]): string[] {
  return entries.map((e) => e.short_code).sort()
}

function createStore(statusQueue: number[] = []) {
  const { deps: dbDeps, records } = createFakeDb()
  const fakeFetch = createFakeFetch(statusQueue)
  const deps: HistoryDeps = { ...dbDeps, fetch: fakeFetch.fetch }
  return { store: createHistoryStore(deps), records, fakeFetch }
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

test('loadFromLocal: only returns records that decrypt with the given password', async () => {
  const { store, records } = createStore()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1'))
  records.push(await encryptEntryForTest(makeEntry('CCCCCC'), 'pw2'))

  const success = await store.loadFromLocal('pw1')

  assert.equal(success, true)
  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA'])
})

test('loadFromLocal: a password matching nothing returns false and leaves state untouched', async () => {
  const { store, records } = createStore()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1'))

  const success = await store.loadFromLocal('wrong-password')

  assert.equal(success, false)
  assert.equal(store.currentIdentity.value, null)
  assert.equal(store.savedList.value.length, 0)
})

test('loadFromLocal: reloading the current identity replaces savedList with the DB state, not a merge', async () => {
  const { store, records } = createStore()
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  // A record saved under the same password elsewhere (e.g. a previous session)
  // that this store's in-memory savedList doesn't know about yet.
  records.push(await encryptEntryForTest(makeEntry('BBBBBB'), 'pw1'))

  await store.loadFromLocal('pw1')

  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA', 'BBBBBB'])
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

test('removeStaleLocalOnly: given a HistoryEntry, only touches sessionList and never calls fetch', () => {
  const { store, fakeFetch } = createStore()
  const entry = makeEntry('AAAAAA')
  store.addToSessionList(entry)

  store.removeStaleLocalOnly(entry)

  assert.equal(store.sessionList.value.length, 0)
  assert.equal(fakeFetch.state.callCount, 0)
})

// --- clearAll ---

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
