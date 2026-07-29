import { RECORD_VERSION, type EncryptedRecord, type IdentityRecord } from '../historyDb.ts'
import { PBKDF2_ITERATIONS } from '../crypto.ts'

/**
 * Stand-in encrypted record. The bytes are not real ciphertext — tests that need data
 * to actually decrypt build their records with `crypto.encrypt` instead. These exist for
 * the storage-level tests, where what matters is the record's shape and its `id`.
 */
export function makeRecord(id: string, overrides: Partial<EncryptedRecord> = {}): EncryptedRecord {
  return {
    id,
    version: RECORD_VERSION,
    identityId: 'identity-1',
    iv: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([4, 5, 6]).buffer,
    ...overrides,
  }
}

export function makeIdentity(id: string, overrides: Partial<IdentityRecord> = {}): IdentityRecord {
  return {
    id,
    salt: new Uint8Array([7, 8, 9]),
    iterations: PBKDF2_ITERATIONS,
    verifier: { iv: new Uint8Array([1, 2, 3]), ciphertext: new Uint8Array([4, 5, 6]).buffer },
    ...overrides,
  }
}

/**
 * Sorts by id before comparing. Real `getAll()` yields key order and the fake deps yield
 * insertion order; neither is part of the contract, so no assertion may depend on it.
 */
export function idsOf(items: { id: string }[]): string[] {
  return items.map((item) => item.id).sort()
}
