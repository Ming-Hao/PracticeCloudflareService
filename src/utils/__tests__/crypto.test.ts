import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveKey, encrypt, decrypt, SALT_LENGTH } from '../crypto.ts'

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

test('encrypt/decrypt round trip returns the original data, including nested objects', async () => {
  const salt = randomSalt()
  const key = await deriveKey('correct-password', salt)
  const data = { short_code: 'AAAAAA', nested: { target_url: 'https://example.com', tags: ['a', 'b'] } }

  const { iv, ciphertext } = await encrypt(data, key)
  const result = await decrypt<typeof data>(iv, ciphertext, key)

  assert.deepEqual(result, data)
})

test('decrypting with the wrong password returns null instead of throwing', async () => {
  const salt = randomSalt()
  const rightKey = await deriveKey('correct-password', salt)
  const wrongKey = await deriveKey('wrong-password', salt)
  const { iv, ciphertext } = await encrypt({ value: 'secret' }, rightKey)

  const result = await decrypt(iv, ciphertext, wrongKey)

  assert.equal(result, null)
})

test('decrypting with a key derived from the wrong salt returns null', async () => {
  const rightKey = await deriveKey('correct-password', randomSalt())
  const wrongSaltKey = await deriveKey('correct-password', randomSalt())
  const { iv, ciphertext } = await encrypt({ value: 'secret' }, rightKey)

  const result = await decrypt(iv, ciphertext, wrongSaltKey)

  assert.equal(result, null)
})

test('tampering with a single ciphertext byte returns null (AES-GCM integrity check)', async () => {
  const key = await deriveKey('correct-password', randomSalt())
  const { iv, ciphertext } = await encrypt({ value: 'secret' }, key)

  const tampered = new Uint8Array(ciphertext.slice(0))
  tampered[0] = tampered[0] ^ 0xff

  const result = await decrypt(iv, tampered.buffer, key)

  assert.equal(result, null)
})

test('encrypting the same data twice produces different IVs', async () => {
  const key = await deriveKey('correct-password', randomSalt())

  const first = await encrypt({ value: 'secret' }, key)
  const second = await encrypt({ value: 'secret' }, key)

  assert.notDeepEqual(first.iv, second.iv)
})

test('the same password and salt derive an interoperable key across separate calls', async () => {
  const salt = randomSalt()
  const keyA = await deriveKey('shared-password', salt)
  const keyB = await deriveKey('shared-password', salt)

  const { iv, ciphertext } = await encrypt({ value: 'secret' }, keyA)
  const result = await decrypt(iv, ciphertext, keyB)

  assert.deepEqual(result, { value: 'secret' })
})
