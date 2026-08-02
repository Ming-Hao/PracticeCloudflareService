import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { resetIndexedDb } from './indexedDbHelpers.ts'
import { makeIdentity, makeRecord } from './historyFixtures.ts'
import {
  putRecord,
  getAllRecords,
  deleteRecord,
  putIdentity,
  getAllIdentities,
} from '../historyDb.ts'

// Why this file exists
//
// Every exported function in historyDb.ts calls openDb(), and for a long time none of them
// closed the connection afterwards — each operation left one open for the lifetime of the
// page. Nothing observable broke. IndexedDB lets any number of connections coexist, reads
// and writes keep working, and no error is ever raised.
//
// The bill arrives at the next DB_VERSION bump. A versionchange transaction needs exclusive
// access to the database, so a single connection still open anywhere in the origin makes the
// upgrade request fire `blocked` and then wait — indefinitely, until that connection closes.
// openDb() registers only onsuccess and onerror, and `blocked` is neither, so its promise
// never settles: no rejection, no timeout, nothing in the console, just history that loads
// forever. The realistic victim is a tab opened after a deploy, held up by a stale tab still
// running the previous bundle.
//
// None of this shows up in a diff — the five functions each read as correct on their own —
// and every test in historyDb.test.ts passes either way, because a single operation against
// a freshly created database has nothing to collide with. This file is the only thing that
// fails when a connection is left open again.
//
// Why it counts connections instead of attempting a real upgrade
//
// Asking for DB_VERSION + 1 and asserting the request is not blocked was the obvious test,
// and it cannot be written here: an IndexedDB open request has no abort, and a blocked one
// re-queues itself through setImmediate until the blocking connection closes
// (FDBFactory.js:150-157 in fake-indexeddb). The event loop then never drains, so the whole
// `node --test` run hangs instead of exiting — in exactly the regression case this file is
// supposed to report. A deadline can settle our own promise but cannot call off the request.
//
// So these tests read the connection list that fake-indexeddb keeps on the database, using
// the same predicate its blocked check uses. The assertion is therefore about connections
// rather than about an upgrade, which pins the current design — one connection per
// operation, closed on the way out. A future move to a long-lived cached connection that
// closes on `versionchange` would be correct and would still fail this file; that change has
// to rewrite these tests rather than delete them.

beforeEach(resetIndexedDb)

// Proves the counter can tell the two states apart, without going through historyDb at all.
// Nothing else here would notice if it broke and started reporting zero unconditionally,
// which would leave the file green while checking nothing.
test('control: the counter sees a connection that was never closed', async () => {
  const leaked = await openConnection()

  assert.equal(await blockingConnectionCount(), 1)

  leaked.close()
  assert.equal(await blockingConnectionCount(), 0)
})

// One call into each exported function, because the connection is opened per operation and
// any single one of them forgetting to release it is enough to block a future upgrade.
test('every operation releases its connection once it is done', async () => {
  await putRecord(makeRecord('a'))
  await getAllRecords()
  await putIdentity(makeIdentity('identity-1'))
  await getAllIdentities()
  await deleteRecord('a')

  assert.equal(await blockingConnectionCount(), 0)
})

const DB_NAME = 'shortlink-history'

/** The private shape this file reads. Not part of the IDBDatabase interface. */
interface FakeConnection {
  _closed: boolean
  _closePending: boolean
}

/**
 * How many open connections would hold up a versionchange transaction. `_closePending`
 * counts as released even before `_closed` is set: a connection whose close is waiting on an
 * in-flight transaction no longer blocks anything, and this mirrors the predicate
 * fake-indexeddb itself applies at FDBFactory.js:151-153.
 */
async function blockingConnectionCount(): Promise<number> {
  const probe = await openConnection()
  const raw = (probe as unknown as { _rawDatabase?: { connections?: FakeConnection[] } })._rawDatabase
  // Closing first keeps the probe out of its own count — closeConnection() drops the
  // connection from the list, and the list is read after that has happened.
  probe.close()
  if (!raw || !Array.isArray(raw.connections)) {
    throw new Error('fake-indexeddb no longer exposes _rawDatabase.connections; this detector needs updating')
  }
  return raw.connections.filter((c) => !c._closed && !c._closePending).length
}

/** Opens at whatever version exists instead of upgrading to one. The caller closes it. */
function openConnection(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
