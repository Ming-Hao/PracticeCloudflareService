import { computed, ref } from 'vue'
import { deriveKey, encrypt, decrypt, PBKDF2_ITERATIONS, SALT_LENGTH } from '../utils/crypto.ts'
import * as historyDb from '../utils/historyDb.ts'

// Encrypted with an identity's key and stored alongside it, so a password can be checked
// against the identity itself instead of by trying to decrypt every record it owns.
export const VERIFIER_PLAINTEXT = 'shortlink-history-identity'

export interface HistoryEntry {
  short_code: string
  target_url: string
  delete_token: string
  created_at: string
}

export interface SavedEntry extends HistoryEntry {
  recordId: string
}

export interface HistoryDbDeps {
  putRecord: typeof historyDb.putRecord
  getAllRecords: typeof historyDb.getAllRecords
  deleteRecord: typeof historyDb.deleteRecord
  putIdentity: typeof historyDb.putIdentity
  getAllIdentities: typeof historyDb.getAllIdentities
}

export interface HistoryDeps extends HistoryDbDeps {
  fetch: typeof globalThis.fetch
}

// Factory so tests can inject fake historyDb/fetch deps and get an isolated store,
// instead of sharing the real app's module-level singleton (see bottom of file).
export function createHistoryStore(deps: HistoryDeps = { ...historyDb, fetch: globalThis.fetch.bind(globalThis) }) {
  const sessionList = ref<HistoryEntry[]>([])
  const savedList = ref<SavedEntry[]>([])
  const currentIdentity = ref<string | null>(null)
  // The unlocked identity and its derived key. Memory-only like the password itself, and
  // not reactive because nothing renders them — they exist so that saving another link
  // reuses the key instead of paying for PBKDF2 again.
  let currentIdentityId: string | null = null
  let currentKey: CryptoKey | null = null

  const badgeCount = computed(() =>
    currentIdentity.value === null
      ? sessionList.value.length
      : sessionList.value.length + savedList.value.length,
  )

  class DeleteLinkError extends Error {
    status: number
    constructor(status: number) {
      super(`Failed to delete short link (status ${status})`)
      this.status = status
    }
  }

  async function deleteLinkOnServer(shortCode: string, deleteToken: string): Promise<void> {
    const res = await deps.fetch(`/${shortCode}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete_token: deleteToken }),
    })
    // The server treats an already soft-deleted link as an idempotent success (200).
    // A 404 means the short code is gone already (e.g. hard-deleted server-side) —
    // callers treat that the same as a successful delete. A 403 (token mismatch) is
    // a genuine failure and must propagate.
    if (!res.ok) {
      throw new DeleteLinkError(res.status)
    }
  }

  function isAlreadyGone(err: unknown): boolean {
    return err instanceof DeleteLinkError && err.status === 404
  }

  function addToSessionList(entry: HistoryEntry): void {
    sessionList.value.push(entry)
  }

  /**
   * Deletes `entry` server-side, plus its IndexedDB record if it is a saved entry.
   * Deliberately does not touch `sessionList` / `savedList`: `clearAll` runs many of
   * these concurrently and updates the lists once at the end (see there for why).
   */
  async function purgeEntry(entry: HistoryEntry | SavedEntry): Promise<void> {
    try {
      await deleteLinkOnServer(entry.short_code, entry.delete_token)
    } catch (err) {
      if (!isAlreadyGone(err)) throw err
    }
    if ('recordId' in entry) {
      await deps.deleteRecord(entry.recordId)
    }
  }

  async function deleteSessionItem(entry: HistoryEntry): Promise<void> {
    await purgeEntry(entry)
    sessionList.value = sessionList.value.filter((e) => e.short_code !== entry.short_code)
  }

  interface UnlockedIdentity {
    id: string
    key: CryptoKey
  }

  /**
   * Finds the identity `password` unlocks, or null if it unlocks none (wrong password).
   * Costs one PBKDF2 derivation per stored identity — normally one or two, as opposed to
   * one per saved record, which is what trying to decrypt every record would cost.
   */
  async function findIdentity(password: string): Promise<UnlockedIdentity | null> {
    if (password === currentIdentity.value && currentIdentityId && currentKey) {
      return { id: currentIdentityId, key: currentKey }
    }
    for (const identity of await deps.getAllIdentities()) {
      const key = await deriveKey(password, identity.salt, identity.iterations)
      const verified = await decrypt<string>(identity.verifier.iv, identity.verifier.ciphertext, key)
      if (verified === VERIFIER_PLAINTEXT) {
        return { id: identity.id, key }
      }
    }
    return null
  }

  /** Resolves `password` to its identity, creating one the first time that password is used. */
  async function unlockIdentity(password: string): Promise<UnlockedIdentity> {
    const existing = await findIdentity(password)
    if (existing) {
      return existing
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
    // Stored per identity rather than read from the constant at decryption time, so that
    // raising PBKDF2_ITERATIONS later leaves existing identities derivable.
    const verifier = await encrypt(VERIFIER_PLAINTEXT, key)
    const id = crypto.randomUUID()
    await deps.putIdentity({ id, salt, iterations: PBKDF2_ITERATIONS, verifier })
    return { id, key }
  }

  function setCurrentIdentity(password: string, identity: UnlockedIdentity): void {
    // savedList only ever reflects currentIdentity's data — switching identity
    // means whatever was in it belongs to the old password and must be dropped.
    if (password !== currentIdentity.value) {
      savedList.value = []
    }
    currentIdentity.value = password
    currentIdentityId = identity.id
    currentKey = identity.key
  }

  /**
   * Encrypts `entry` and writes it to IndexedDB.
   * - Pass `password` to establish/switch identity (fresh save or "save as").
   * - Omit `password` to reuse the current identity ("save to current identity").
   * - Pass `previousRecordId` when replacing an existing saved copy of this entry
   *   under a different password; the caller is responsible for asking the user
   *   whether to discard that old record via `discardOldRecord`.
   */
  async function saveToLocal(
    entry: HistoryEntry,
    options: { password?: string; previousRecordId?: string } = {},
  ): Promise<{ recordId: string; previousRecordId?: string }> {
    const password = options.password ?? currentIdentity.value
    if (!password) {
      throw new Error('saveToLocal requires a password when there is no current identity')
    }

    const identity = await unlockIdentity(password)
    const { iv, ciphertext } = await encrypt(entry, identity.key)
    const recordId = crypto.randomUUID()
    await deps.putRecord({
      id: recordId,
      version: historyDb.RECORD_VERSION,
      identityId: identity.id,
      iv,
      ciphertext,
    })

    setCurrentIdentity(password, identity)
    sessionList.value = sessionList.value.filter((e) => e.short_code !== entry.short_code)
    if (options.previousRecordId) {
      savedList.value = savedList.value.filter((e) => e.recordId !== options.previousRecordId)
    }
    savedList.value.push({ ...entry, recordId })

    return { recordId, previousRecordId: options.previousRecordId }
  }

  async function discardOldRecord(recordId: string): Promise<void> {
    await deps.deleteRecord(recordId)
  }

  /**
   * Unlocks the identity `password` belongs to and loads its records.
   * Returns false only when no identity matches, i.e. the password is wrong. An identity
   * holding no records still returns true: the password was right and the drawer should
   * say the identity is empty, not that the password matched nothing.
   */
  async function loadFromLocal(password: string): Promise<boolean> {
    const identity = await findIdentity(password)
    if (!identity) {
      return false
    }
    const records = await deps.getAllRecords()
    const decrypted: SavedEntry[] = []
    for (const record of records) {
      if (record.identityId !== identity.id) continue
      const entry = await decrypt<HistoryEntry>(record.iv, record.ciphertext, identity.key)
      if (entry) {
        decrypted.push({ ...entry, recordId: record.id })
      }
    }
    setCurrentIdentity(password, identity)
    savedList.value = decrypted
    return true
  }

  async function deleteSavedItem(entry: SavedEntry): Promise<void> {
    await purgeEntry(entry)
    savedList.value = savedList.value.filter((e) => e.recordId !== entry.recordId)
  }

  /** Server already reports this link as gone (404) — clear the local copy without calling the delete API. */
  function removeStaleLocalOnly(entry: HistoryEntry | SavedEntry): void {
    if ('recordId' in entry) {
      void deps.deleteRecord(entry.recordId)
      savedList.value = savedList.value.filter((e) => e.recordId !== entry.recordId)
    } else {
      sessionList.value = sessionList.value.filter((e) => e.short_code !== entry.short_code)
    }
  }

  /** Runs `purgeEntry` over `entries`, keeping the ones that succeeded instead of failing fast. */
  async function purgeAll<T extends HistoryEntry | SavedEntry>(
    entries: T[],
  ): Promise<{ succeeded: T[]; failed: number }> {
    const results = await Promise.allSettled(entries.map((entry) => purgeEntry(entry)))
    const succeeded = entries.filter((_, i) => results[i]?.status === 'fulfilled')
    return { succeeded, failed: results.length - succeeded.length }
  }

  /**
   * Deletes everything in both lists, reporting how many could not be deleted.
   * A single failure (typically a 403 from a link whose token no longer matches) must
   * not hide the deletions that did succeed — Promise.all would reject on the first one
   * and leave the caller reporting total failure while most links were already gone.
   *
   * Each list is filtered exactly once, at the end. Letting every concurrent delete
   * filter the list itself is a read-modify-write race: two deletes reading the same
   * snapshot would have the later write resurrect the entry the earlier one removed.
   */
  async function clearAll(): Promise<{ failed: number }> {
    const saved = await purgeAll([...savedList.value])
    const session = await purgeAll([...sessionList.value])

    const purgedRecordIds = new Set(saved.succeeded.map((e) => e.recordId))
    const purgedShortCodes = new Set(session.succeeded.map((e) => e.short_code))
    savedList.value = savedList.value.filter((e) => !purgedRecordIds.has(e.recordId))
    sessionList.value = sessionList.value.filter((e) => !purgedShortCodes.has(e.short_code))

    return { failed: saved.failed + session.failed }
  }

  return {
    sessionList,
    savedList,
    currentIdentity,
    badgeCount,
    addToSessionList,
    deleteSessionItem,
    saveToLocal,
    discardOldRecord,
    loadFromLocal,
    deleteSavedItem,
    removeStaleLocalOnly,
    clearAll,
  }
}

// Module-level singleton so every component sharing this composable sees the same session data.
const store = createHistoryStore()

export function useHistory() {
  return store
}
