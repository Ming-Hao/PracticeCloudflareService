import { IDBFactory } from 'fake-indexeddb'

// Mirrors the constants in historyDb.ts. Deliberately re-declared rather than exported from
// there: these describe the database as it exists on a user's device, and a test that seeds
// the old v1 layout has to be able to name stores the current code no longer creates.
const DB_NAME = 'shortlink-history'
const STORE_NAME = 'records'

/**
 * Swaps in a brand-new in-memory IndexedDB, so each test starts from a device with no
 * database at all. `openDb()` reads the global at call time, so replacing it is enough —
 * the module under test does not need to be reloaded.
 */
export function resetIndexedDb(): void {
  globalThis.indexedDB = new IDBFactory()
}

function closed(db: IDBDatabase): void {
  // Every helper closes its connection before resolving. A connection left open at an older
  // version blocks the upgrade the code under test performs, and `openDb()` registers no
  // `onblocked` handler, so the test would hang rather than fail.
  db.close()
}

/**
 * Recreates the pre-v1.3.0 database: version 1, a single `records` store, no `identities`.
 * `records` are written as-is, so callers can seed the v1 record shape (a per-record salt,
 * no `identityId`) that the current `EncryptedRecord` type no longer describes.
 */
export function seedV1Db(records: object[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(STORE_NAME, 'readwrite')
      for (const record of records) {
        tx.objectStore(STORE_NAME).put(record)
      }
      tx.oncomplete = () => {
        closed(db)
        resolve()
      }
      tx.onerror = () => {
        closed(db)
        reject(tx.error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/** Object store names of the database as it currently stands, without forcing an upgrade. */
export function storeNamesOf(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Opened without a version: returns whatever version exists instead of upgrading to one.
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => {
      const db = request.result
      const names = [...db.objectStoreNames]
      closed(db)
      resolve(names)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Reads a store directly, bypassing historyDb — used to check what a migration left behind. */
export function readStore(storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(storeName, 'readonly')
      const getAll = tx.objectStore(storeName).getAll()
      getAll.onsuccess = () => {
        closed(db)
        resolve(getAll.result)
      }
      getAll.onerror = () => {
        closed(db)
        reject(getAll.error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}
