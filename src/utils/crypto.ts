const PBKDF2_ITERATIONS = 100_000
export const SALT_LENGTH = 16
export const IV_LENGTH = 12

export interface EncryptedPayload {
  iv: Uint8Array
  ciphertext: ArrayBuffer
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encrypt(data: unknown, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext)
  return { iv, ciphertext }
}

export async function decrypt<T>(iv: Uint8Array, ciphertext: ArrayBuffer, key: CryptoKey): Promise<T | null> {
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    // AES-GCM authentication failure means wrong key (wrong password) — not an error to surface
    return null
  }
}
