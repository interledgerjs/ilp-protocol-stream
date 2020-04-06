import { Reader, Writer } from 'oer-utils'
import {
  LongValue,
  longFromValue
} from './long'
import * as Long from 'long'
import { generateReceiptHMAC } from '../crypto'

const RECEIPT_VERSION = 1
export { RECEIPT_VERSION }

export interface ReceiptOpts {
  nonce: Buffer
  streamId: LongValue
  totalReceived: LongValue
  secret: Buffer
}

export interface Receipt {
  version: number
  nonce: Buffer
  streamId: string
  totalReceived: Long
}

export function createReceipt (opts: ReceiptOpts): Buffer {
  if (opts.nonce.length !== 16) {
    throw new Error('receipt nonce must be 16 bytes')
  }
  if (opts.secret.length !== 32) {
    throw new Error('receipt secret must be 32 bytes')
  }
  const receipt = new Writer(58)
  receipt.writeUInt8(RECEIPT_VERSION)
  receipt.writeOctetString(opts.nonce, 16)
  receipt.writeUInt8(opts.streamId)
  receipt.writeUInt64(longFromValue(opts.totalReceived, true))
  receipt.writeOctetString(generateReceiptHMAC(opts.secret, receipt.getBuffer()), 32)
  return receipt.getBuffer()
}

export function decodeReceipt (receipt: Buffer): Receipt {
  if (receipt.length !== 58) {
    throw new Error('receipt must be 58 bytes')
  }
  const reader = Reader.from(receipt)
  const version = reader.readUInt8Number()
  const nonce = reader.readOctetString(16)
  const streamId = reader.readUInt8()
  const totalReceived = reader.readUInt64Long()
  return {
    version,
    nonce,
    streamId,
    totalReceived
  }
}

export function verifyReceipt (receipt: Buffer, secret: Buffer): Boolean {
  if (receipt.length !== 58) {
    return false
  }
  const reader = Reader.from(receipt)
  if (reader.readUInt8Number() !== RECEIPT_VERSION) {
    return false
  }
  const message = reader.buffer.slice(0, 26)
  const receiptHmac = reader.buffer.slice(26)

  return receiptHmac.equals(generateReceiptHMAC(secret, message))
}
