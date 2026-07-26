import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHistoryStore, type HistoryDbDeps, type HistoryEntry } from '../useHistory.ts'
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

async function encryptEntryForTest(entry: HistoryEntry, password: string): Promise<EncryptedRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await deriveKey(password, salt)
  const { iv, ciphertext } = await encrypt(entry, key)
  return { id: crypto.randomUUID(), salt, iv, ciphertext }
}

function makeEntry(short_code: string): HistoryEntry {
  return {
    short_code,
    target_url: `https://example.com/${short_code}`,
    delete_token: `token-${short_code}`,
    created_at: new Date().toISOString(),
  }
}

function shortCodesOf(entries: { short_code: string }[]): string[] {
  return entries.map((e) => e.short_code).sort()
}

test('saveToLocal: fresh identity moves the entry from sessionList into savedList', async () => {
  const { deps } = createFakeDb()
  const store = createHistoryStore(deps)
  const entryA = makeEntry('AAAAAA')
  store.addToSessionList(entryA)

  await store.saveToLocal(entryA, { password: 'pw1' })

  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA'])
  assert.equal(store.sessionList.value.length, 0)
})

test('saveToLocal: saving again with the same password accumulates onto savedList', async () => {
  const { deps } = createFakeDb()
  const store = createHistoryStore(deps)
  const entryA = makeEntry('AAAAAA')
  const entryB = makeEntry('BBBBBB')
  await store.saveToLocal(entryA, { password: 'pw1' })

  store.addToSessionList(entryB)
  await store.saveToLocal(entryB, { password: 'pw1' })

  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA', 'BBBBBB'])
})

test('saveToLocal: saving with a different password drops the previous identity from savedList', async () => {
  const { deps } = createFakeDb()
  const store = createHistoryStore(deps)
  const entryA = makeEntry('AAAAAA')
  const entryB = makeEntry('BBBBBB')
  await store.saveToLocal(entryA, { password: 'pw1' })

  store.addToSessionList(entryB)
  await store.saveToLocal(entryB, { password: 'pw2' })

  assert.equal(store.currentIdentity.value, 'pw2')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['BBBBBB'])
})

test('loadFromLocal: only returns records that decrypt with the given password', async () => {
  const { deps, records } = createFakeDb()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1'))
  records.push(await encryptEntryForTest(makeEntry('CCCCCC'), 'pw2'))

  const store = createHistoryStore(deps)
  const success = await store.loadFromLocal('pw1')

  assert.equal(success, true)
  assert.equal(store.currentIdentity.value, 'pw1')
  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA'])
})

test('loadFromLocal: a password matching nothing returns false and leaves state untouched', async () => {
  const { deps, records } = createFakeDb()
  records.push(await encryptEntryForTest(makeEntry('AAAAAA'), 'pw1'))

  const store = createHistoryStore(deps)
  const success = await store.loadFromLocal('wrong-password')

  assert.equal(success, false)
  assert.equal(store.currentIdentity.value, null)
  assert.equal(store.savedList.value.length, 0)
})

test('loadFromLocal: reloading the current identity replaces savedList with the DB state, not a merge', async () => {
  const { deps, records } = createFakeDb()
  const store = createHistoryStore(deps)
  await store.saveToLocal(makeEntry('AAAAAA'), { password: 'pw1' })

  // A record saved under the same password elsewhere (e.g. a previous session)
  // that this store's in-memory savedList doesn't know about yet.
  records.push(await encryptEntryForTest(makeEntry('BBBBBB'), 'pw1'))

  await store.loadFromLocal('pw1')

  assert.deepEqual(shortCodesOf(store.savedList.value), ['AAAAAA', 'BBBBBB'])
})
