import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { resetIndexedDb, seedV1Db, storeNamesOf, readStore } from './indexedDbHelpers.ts'
import { makeIdentity, makeRecord, idsOf } from './historyFixtures.ts'
import {
  RECORD_VERSION,
  putRecord,
  getAllRecords,
  deleteRecord,
  putIdentity,
  getAllIdentities,
} from '../historyDb.ts'
import { deriveKey, encrypt, decrypt, PBKDF2_ITERATIONS, SALT_LENGTH } from '../crypto.ts'

// Every test runs against a device with no database, so the upgrade path under test is the
// one a real user hits exactly once. Global state, so this is a hook rather than a call the
// individual tests could forget to make.
beforeEach(resetIndexedDb)

// --- migration (v1 -> v2) ---

// The CHANGELOG promises that local history from before v1.3.0 is dropped on upgrade and
// cannot be recovered. Until now that was only a claim in prose. Both directions of failure
// matter: records surviving would be zombies no password can decrypt (loadFromLocal skips
// them on identityId, so they would silently accumulate), and over-deleting would take the
// identities store with them.
test('migration: opening a v1 database as v2 clears the old records and adds the identities store', async () => {
  await seedV1Db([
    { id: 'old-1', salt: new Uint8Array([1]), iv: new Uint8Array([2]), ciphertext: new ArrayBuffer(8) },
    { id: 'old-2', salt: new Uint8Array([3]), iv: new Uint8Array([4]), ciphertext: new ArrayBuffer(8) },
  ])
  assert.equal((await readStore('records')).length, 2, 'precondition: the v1 database holds records')

  const records = await getAllRecords()

  assert.deepEqual(records, [])
  assert.deepEqual([...(await storeNamesOf())].sort(), ['identities', 'records'])
})

test('fresh install: opening with no existing database creates both stores, empty', async () => {
  const records = await getAllRecords()
  const identities = await getAllIdentities()

  assert.deepEqual(records, [])
  assert.deepEqual(identities, [])
  assert.deepEqual([...(await storeNamesOf())].sort(), ['identities', 'records'])
})

// --- CRUD ---

test('putRecord: the written record comes back from getAllRecords', async () => {
  await putRecord(makeRecord('a'))

  assert.deepEqual(idsOf(await getAllRecords()), ['a'])
})

// saveToLocal always mints a fresh UUID, so nothing exercises this today. It is pinned
// because `put` (overwrite) rather than `add` (reject duplicates) is the semantic the fake
// deps have to match, and the one a future "update an existing record" flow would rely on.
test('putRecord: writing the same id twice overwrites instead of adding a second record', async () => {
  await putRecord(makeRecord('a', { identityId: 'identity-1' }))
  await putRecord(makeRecord('a', { identityId: 'identity-2' }))

  const records = await getAllRecords()

  assert.equal(records.length, 1)
  assert.equal(records[0]?.identityId, 'identity-2')
})

test('deleteRecord: removes only the named record', async () => {
  await putRecord(makeRecord('a'))
  await putRecord(makeRecord('b'))

  await deleteRecord('a')

  assert.deepEqual(idsOf(await getAllRecords()), ['b'])
})

test('deleteRecord: deleting an id that is not there is not an error', async () => {
  await putRecord(makeRecord('a'))

  await deleteRecord('missing')

  assert.deepEqual(idsOf(await getAllRecords()), ['a'])
})

test('putIdentity: the written identity comes back from getAllIdentities', async () => {
  await putIdentity(makeIdentity('identity-1'))

  assert.deepEqual(idsOf(await getAllIdentities()), ['identity-1'])
})

test('records and identities are separate stores: writing to one leaves the other alone', async () => {
  await putRecord(makeRecord('a'))
  await putIdentity(makeIdentity('identity-1'))

  await deleteRecord('a')

  assert.deepEqual(await getAllRecords(), [])
  assert.deepEqual(idsOf(await getAllIdentities()), ['identity-1'])
})

// --- crypto <-> historyDb integration ---

// The first tests to send data through the real historyDb rather than an injected fake.
// IndexedDB stores values by structured clone, so `iv` and `ciphertext` are serialized on
// the way in and rebuilt on the way out — the fakes hand back the very object they were
// given and can never show a problem here. A break would be brutal to diagnose: `decrypt`
// returns null for anything it cannot open, so corruption in transit is indistinguishable
// from a wrong password, and the user is told their correct password is wrong.
test('round trip: a record encrypted with crypto.encrypt still decrypts after a real store/load', async () => {
  const key = await deriveKey('correct-password', randomSalt())
  const entry = { short_code: 'AAAAAA', target_url: 'https://example.com', delete_token: 'tok', created_at: 'now' }
  const { iv, ciphertext } = await encrypt(entry, key)
  await putRecord({ id: 'a', version: RECORD_VERSION, identityId: 'identity-1', iv, ciphertext })

  const stored = (await getAllRecords())[0]

  assert.ok(stored)
  assert.deepEqual(await decrypt(stored.iv, stored.ciphertext, key), entry)
})

// An identity is the newer structure and the riskier one: `salt` is a TypedArray and
// `verifier` is a nested object holding two more of them.
test('round trip: a stored identity still derives a key that verifies its own verifier', async () => {
  const salt = randomSalt()
  const key = await deriveKey('correct-password', salt)
  await putIdentity({
    id: 'identity-1',
    salt,
    iterations: PBKDF2_ITERATIONS,
    verifier: await encrypt('shortlink-history-identity', key),
  })

  const stored = (await getAllIdentities())[0]

  assert.ok(stored)
  const rederived = await deriveKey('correct-password', stored.salt, stored.iterations)
  const verified = await decrypt(stored.verifier.iv, stored.verifier.ciphertext, rederived)
  assert.equal(verified, 'shortlink-history-identity')
})

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}
