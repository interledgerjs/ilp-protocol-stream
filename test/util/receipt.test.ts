import 'mocha'
import {
  createReceipt,
  decodeReceipt,
  verifyReceipt,
  RECEIPT_VERSION
} from '../../src/util/receipt'
import * as sinon from 'sinon'
import * as Chai from 'chai'
import { Writer } from 'oer-utils'
import * as chaiAsPromised from 'chai-as-promised'
import * as Long from 'long'
import { longFromValue } from '../../src/util/long'
import { randomBytes } from '../../src/crypto'
Chai.use(chaiAsPromised)
const assert = Object.assign(Chai.assert, sinon.assert)

describe('Receipt', function () {
  const receiptFixture = require('../fixtures/packets.json').find(({ name }: { name: string}) => name === 'frame:stream_receipt' ).packet.frames[0].receipt

  describe('createReceipt', function () {
    it('should create a receipt', function () {
      const receipt = createReceipt({
        nonce: Buffer.alloc(16),
        streamId: '1',
        totalReceived: '500',
        secret: Buffer.alloc(32)
      })
      assert(receipt.equals(receiptFixture))
    })
    it('should require 16 byte nonce', function () {
      assert.throws(() => createReceipt({
        nonce: Buffer.alloc(8),
        streamId: 'id',
        totalReceived: '1',
        secret: Buffer.alloc(32)
      }), 'receipt nonce must be 16 bytes')
    })
    it('should require 32 byte secret', function () {
      assert.throws(() => createReceipt({
        nonce: Buffer.alloc(16),
        streamId: 'id',
        totalReceived: '1',
        secret: Buffer.alloc(31)
      }), 'receipt secret must be 32 bytes')
    })
  })

  describe('decodeReceipt', function () {
    it('should decode receipt', function () {
      const receipt = decodeReceipt(receiptFixture)
      assert.strictEqual(receipt.version, RECEIPT_VERSION)
      assert(receipt.nonce.equals(Buffer.alloc(16)))
      assert.strictEqual(receipt.streamId, '1')
      assert(receipt.totalReceived.equals(500))
    })
    it('should require 58 byte receipt', function () {
      assert.throws(() => decodeReceipt(Buffer.alloc(32)), 'receipt must be 58 bytes')
    })
  })

  describe('verifyReceipt', function () {
    it('should return true for valid receipt', function () {
      const secret = Buffer.alloc(32)
      assert.strictEqual(verifyReceipt(receiptFixture, secret), true)
    })
    it('should return false for invalid receipt length', function () {
      const secret = Buffer.alloc(32)
      assert.strictEqual(verifyReceipt(Buffer.alloc(57), secret), false)
    })
    it('should return false for invalid receipt version', function () {
      const secret = Buffer.alloc(32)
      assert.strictEqual(verifyReceipt(Buffer.alloc(58), secret), false)
    })
    it('should return false for invalid receipt hmac', function () {
      const secret = randomBytes(32)
      assert.strictEqual(verifyReceipt(receiptFixture, secret), false)
    })
  })
})
