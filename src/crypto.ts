import * as crypto from 'crypto'
import * as assert from 'assert'
require('source-map-support').install()

const HASH_ALGORITHM = 'sha256'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption', 'utf8')
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
export const ENCRYPTION_OVERHEAD = 28

const FULFILLMENT_GENERATION_STRING = Buffer.from('ilp_stream_fulfillment', 'utf8')

const TOKEN_LENGTH = 18
const SHARED_SECRET_GENERATION_STRING = Buffer.from('ilp_stream_shared_secret', 'utf8')

const sharedSecretMap = new Map()
const fulfillmentKeyMap = new Map()
const pskKeyMap = new Map()

export function generateToken (): Buffer {
  return crypto.randomBytes(TOKEN_LENGTH)
}

export function generateTokenAndSharedSecret (seed: Buffer): { token: Buffer, sharedSecret: Buffer } {
  const token = crypto.randomBytes(TOKEN_LENGTH)
  const sharedSecret = generateSharedSecretFromToken(seed, token)
  return { token, sharedSecret }
}

export function generateSharedSecretFromToken (seed: Buffer, token: Buffer): Buffer {
  let sharedSecret = sharedSecretMap.get(token)
  if (!sharedSecret) {
    const keygen = hmac(seed, SHARED_SECRET_GENERATION_STRING)
    sharedSecret = hmac(keygen, token)
    sharedSecretMap.set(token, sharedSecret)
  }
  return sharedSecret
}

export function generateRandomCondition () {
  return crypto.randomBytes(32)
}

export function generateFulfillment (sharedSecret: Buffer, data: Buffer) {
  let fulfillmentKey = fulfillmentKeyMap.get(sharedSecret)
  if (!fulfillmentKey) {
    fulfillmentKey = hmac(sharedSecret, FULFILLMENT_GENERATION_STRING)
    fulfillmentKeyMap.set(sharedSecret, fulfillmentKey)
  }
  return hmac(fulfillmentKey, data)
}

export function hash (preimage: Buffer) {
  const h = crypto.createHash(HASH_ALGORITHM)
  h.update(preimage)
  return h.digest()
}

function getPskEncryptionKey (sharedSecret: Buffer) {
  let key = pskKeyMap.get(sharedSecret)
  if (!key) {
    key = hmac(sharedSecret, ENCRYPTION_KEY_STRING)
    pskKeyMap.set(sharedSecret, key)
  }
  return key
}

export function encrypt (sharedSecret: Buffer, ...buffers: Buffer[]): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH)
  const pskEncryptionKey = getPskEncryptionKey(sharedSecret)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, iv)

  const ciphertext = []
  for (let buffer of buffers) {
    ciphertext.push(cipher.update(buffer))
  }
  ciphertext.push(cipher.final())
  const tag = cipher.getAuthTag()
  ciphertext.unshift(iv, tag)
  return Buffer.concat(ciphertext)
}

export function decrypt (sharedSecret: Buffer, data: Buffer): Buffer {
  assert(data.length > 0, 'cannot decrypt empty buffer')
  const pskEncryptionKey = getPskEncryptionKey(sharedSecret)
  const nonce = data.slice(0, IV_LENGTH)
  const tag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.slice(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, pskEncryptionKey, nonce)
  decipher.setAuthTag(tag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])
}

function hmac (key: Buffer, message: Buffer): Buffer {
  const h = crypto.createHmac(HASH_ALGORITHM, key)
  h.update(message)
  return h.digest()
}
