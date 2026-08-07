import type { HistoryDbDeps } from '../../composables/useHistory.ts'
import type { EncryptedRecord, IdentityRecord } from '../historyDb.ts'

/**
 * In-memory stand-in for historyDb, injected into `createHistoryStore` so the composable's
 * tests run without an IndexedDB. It lives beside the implementation it imitates, and
 * `historyDb.contract.test.ts` runs the same assertions against both — the two are only
 * interchangeable for as long as something checks that they behave alike.
 *
 * `records` and `identities` are handed back so tests can assert on what reached storage.
 *
 * `options.failDeleteRecord` makes `deleteRecord` reject, for exercising failure paths such as
 * removeStaleLocalOnly. It defaults off, so the contract-checked default behaviour is unchanged
 * and historyDb.contract.test.ts still sees the two implementations agree.
 */
export function createFakeDb(
  options: { failDeleteRecord?: boolean } = {},
): { deps: HistoryDbDeps; records: EncryptedRecord[]; identities: IdentityRecord[] } {
  const records: EncryptedRecord[] = []
  const identities: IdentityRecord[] = []
  return {
    records,
    identities,
    deps: {
      async putRecord(record) {
        upsert(records, record)
      },
      async getAllRecords() {
        return [...records]
      },
      async deleteRecord(id) {
        if (options.failDeleteRecord) throw new Error('fake deleteRecord failure')
        const index = records.findIndex((r) => r.id === id)
        if (index !== -1) records.splice(index, 1)
      },
      async putIdentity(identity) {
        upsert(identities, identity)
      },
      async getAllIdentities() {
        return [...identities]
      },
    },
  }
}

/** Matches IndexedDB's `put` on a `keyPath: 'id'` store: same id replaces, new id appends. */
function upsert<T extends { id: string }>(list: T[], item: T): void {
  const index = list.findIndex((existing) => existing.id === item.id)
  if (index === -1) {
    list.push(item)
  } else {
    list[index] = item
  }
}
