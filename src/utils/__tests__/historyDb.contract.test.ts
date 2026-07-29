import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resetIndexedDb } from './indexedDbHelpers.ts'
import { createFakeDb } from './fakeHistoryDb.ts'
import { makeIdentity, makeRecord, idsOf } from './historyFixtures.ts'
import * as historyDb from '../historyDb.ts'
import type { HistoryDbDeps } from '../../composables/useHistory.ts'

/**
 * Making historyDb injectable bought fast composable tests, at the price of a second
 * implementation. Nothing about a drift between the two is self-announcing: the fake going
 * out of step does not turn a test red or move coverage, it just quietly makes every
 * useHistory test describe a storage layer that no longer exists.
 *
 * So both implementations run the same assertions here. These are the promises useHistory
 * relies on, and neither implementation may be the only one that keeps them.
 */
function runContractTests(name: string, createDeps: () => HistoryDbDeps): void {
  describe(`HistoryDbDeps contract: ${name}`, () => {
    test('a written record is readable', async () => {
      const deps = createDeps()

      await deps.putRecord(makeRecord('a'))

      assert.deepEqual(idsOf(await deps.getAllRecords()), ['a'])
    })

    test('writing the same id twice replaces rather than appends', async () => {
      const deps = createDeps()

      await deps.putRecord(makeRecord('a', { identityId: 'identity-1' }))
      await deps.putRecord(makeRecord('a', { identityId: 'identity-2' }))

      const records = await deps.getAllRecords()

      assert.equal(records.length, 1)
      assert.equal(records[0]?.identityId, 'identity-2')
    })

    test('a deleted record is gone and its neighbours are untouched', async () => {
      const deps = createDeps()
      await deps.putRecord(makeRecord('a'))
      await deps.putRecord(makeRecord('b'))

      await deps.deleteRecord('a')

      assert.deepEqual(idsOf(await deps.getAllRecords()), ['b'])
    })

    test('deleting an id that was never written is not an error', async () => {
      const deps = createDeps()
      await deps.putRecord(makeRecord('a'))

      await deps.deleteRecord('missing')

      assert.deepEqual(idsOf(await deps.getAllRecords()), ['a'])
    })

    test('a written identity is readable, and identities replace by id too', async () => {
      const deps = createDeps()

      await deps.putIdentity(makeIdentity('identity-1', { iterations: 1000 }))
      await deps.putIdentity(makeIdentity('identity-1', { iterations: 2000 }))

      const identities = await deps.getAllIdentities()

      assert.equal(identities.length, 1)
      assert.equal(identities[0]?.iterations, 2000)
    })

    test('records and identities do not see each other', async () => {
      const deps = createDeps()
      await deps.putRecord(makeRecord('a'))
      await deps.putIdentity(makeIdentity('identity-1'))

      await deps.deleteRecord('a')

      assert.deepEqual(await deps.getAllRecords(), [])
      assert.deepEqual(idsOf(await deps.getAllIdentities()), ['identity-1'])
    })

    // The one property the fake gets for free and the real implementation does not: IndexedDB
    // stores by structured clone. Trivially true on one side is the point — it is the real
    // side this pins, and useHistory's tests are only meaningful if both sides agree.
    test('Uint8Array and ArrayBuffer come back as the same types and bytes', async () => {
      const deps = createDeps()
      const iv = new Uint8Array([9, 8, 7])
      const ciphertext = new Uint8Array([1, 2, 3, 4]).buffer

      await deps.putRecord(makeRecord('a', { iv, ciphertext }))
      const stored = (await deps.getAllRecords())[0]

      assert.ok(stored)
      assert.ok(stored.iv instanceof Uint8Array)
      assert.ok(stored.ciphertext instanceof ArrayBuffer)
      assert.deepEqual([...stored.iv], [9, 8, 7])
      assert.deepEqual([...new Uint8Array(stored.ciphertext)], [1, 2, 3, 4])
    })

    test('a nested EncryptedPayload survives inside an identity', async () => {
      const deps = createDeps()
      const verifier = { iv: new Uint8Array([5, 5]), ciphertext: new Uint8Array([6, 6]).buffer }

      await deps.putIdentity(makeIdentity('identity-1', { verifier }))
      const stored = (await deps.getAllIdentities())[0]

      assert.ok(stored)
      assert.ok(stored.salt instanceof Uint8Array)
      assert.deepEqual([...stored.verifier.iv], [5, 5])
      assert.deepEqual([...new Uint8Array(stored.verifier.ciphertext)], [6, 6])
    })
  })
}

runContractTests('fake (the deps injected into useHistory tests)', () => createFakeDb().deps)

runContractTests('real (historyDb over fake-indexeddb)', () => {
  resetIndexedDb()
  return historyDb
})
