import type { EncryptedPayload } from './crypto.ts'

const DB_NAME = 'shortlink-history'
const DB_VERSION = 2
const STORE_NAME = 'records'
const IDENTITY_STORE_NAME = 'identities'

// Shape of the records written from now on. Bumped only when the record structure
// changes, and stored per record rather than relying on DB_VERSION, which is database-wide
// and so cannot tell a record written before an upgrade from one written after it.
// It stays outside the ciphertext on purpose: deciding how to read a record has to happen
// before decrypting it. The cost is that the version is readable without the password.
export const RECORD_VERSION = 1

// `id` is a random identifier for this encrypted record, independent of `short_code` —
// the same short link can have multiple encrypted copies under different passwords
// (see "save as" flow), so short_code cannot be the primary key.
export interface EncryptedRecord {
  id: string
  version: number
  identityId: string
  iv: Uint8Array
  ciphertext: ArrayBuffer
}

// One row per password ever used on this device. The salt and iteration count live here
// rather than on each record so that unlocking derives a key once instead of once per
// record, and `verifier` — a known plaintext encrypted with that key — is what tells a
// correct password apart from a wrong one without storing the password itself.
export interface IdentityRecord {
  id: string
  salt: Uint8Array
  iterations: number
  verifier: EncryptedPayload
}

/**
 * Opens a connection, hands it to `fn`, and closes it once `fn` settles.
 *
 * The close is the point. A connection left open blocks the next `versionchange` transaction
 * — the upgrade request fires `blocked` and then waits for the connection to close, which
 * for a leaked one never happens. `openDb()` handles only `onsuccess` and `onerror`, so a
 * blocked request settles nothing and the caller waits forever with no error to show.
 *
 * Opening per operation rather than caching one long-lived connection is deliberate: a cached
 * connection has to listen for `versionchange` and close itself on demand, invalidate the
 * cache afterwards, and expose a reset hook so tests can drop it. Reopening costs nothing at
 * the volume this app writes. See `historyDb.connections.test.ts`.
 */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb()
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      // v1 records each carried their own salt and belong to no identity. Grouping them
      // would require the password, which is never stored, so v2 starts empty instead.
      // Local history is unrecoverable by design.
      if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(IDENTITY_STORE_NAME)) {
        db.createObjectStore(IDENTITY_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function putRecord(record: EncryptedRecord): Promise<void> {
  return withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(record)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function getAllRecords(): Promise<EncryptedRecord[]> {
  return withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).getAll()
        request.onsuccess = () => resolve(request.result as EncryptedRecord[])
        request.onerror = () => reject(request.error)
      }),
  )
}

export function deleteRecord(id: string): Promise<void> {
  return withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function putIdentity(identity: IdentityRecord): Promise<void> {
  return withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDENTITY_STORE_NAME, 'readwrite')
        tx.objectStore(IDENTITY_STORE_NAME).put(identity)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function getAllIdentities(): Promise<IdentityRecord[]> {
  return withDb(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDENTITY_STORE_NAME, 'readonly')
        const request = tx.objectStore(IDENTITY_STORE_NAME).getAll()
        request.onsuccess = () => resolve(request.result as IdentityRecord[])
        request.onerror = () => reject(request.error)
      }),
  )
}
