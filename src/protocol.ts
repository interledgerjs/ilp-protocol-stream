import { Reader, Writer, Predictor } from 'oer-utils'
import BigNumber from 'bignumber.js'
import { encrypt, decrypt, ENCRYPTION_OVERHEAD } from './crypto'
import * as assert from 'assert'
require('source-map-support').install()

const VERSION = 1

const ZERO_BYTES = Buffer.alloc(32)
const MAX_UINT64 = new BigNumber('18446744073709551615')

export enum IlpPacketType {
  Prepare = 12,
  Fulfill = 13,
  Reject = 14
}

/**
 * ILP/STREAM packet
 */
export class Packet {
  sequence: BigNumber
  ilpPacketType: IlpPacketType
  prepareAmount: BigNumber
  frames: Frame[]

  constructor (sequence: BigNumber.Value, ilpPacketType: IlpPacketType, packetAmount: BigNumber.Value = 0, frames: Frame[] = []) {
    this.sequence = new BigNumber(sequence)
    this.ilpPacketType = ilpPacketType
    this.prepareAmount = new BigNumber(packetAmount)
    this.frames = frames
  }

  static decryptAndDeserialize (sharedSecret: Buffer, buffer: Buffer): Packet {
    let decrypted: Buffer
    try {
      decrypted = decrypt(sharedSecret, buffer)
    } catch (err) {
      throw new Error(`Unable to decrypt packet. Data was corrupted or packet was encrypted with the wrong key`)
    }
    return Packet._deserializeUnencrypted(decrypted)
  }

  /** @private */
  static _deserializeUnencrypted (buffer: Buffer): Packet {
    const reader = Reader.from(buffer)
    const version = reader.readUInt8BigNum()
    if (!version.isEqualTo(VERSION)) {
      throw new Error(`Unsupported protocol version: ${version}`)
    }
    const ilpPacketType = reader.readUInt8BigNum().toNumber()
    const sequence = reader.readVarUIntBigNum()
    const packetAmount = reader.readVarUIntBigNum()
    const numFrames = reader.readVarUIntBigNum().toNumber()
    const frames: Frame[] = []

    for (let i = 0; i < numFrames; i++) {
      const frame = parseFrame(reader)
      if (frame) {
        frames.push(frame)
      }
    }
    return new Packet(sequence, ilpPacketType, packetAmount, frames)
  }

  serializeAndEncrypt (sharedSecret: Buffer, padPacketToSize?: number): Buffer {
    const serialized = this._serialize()

    // Pad packet to max data size, if desired
    if (padPacketToSize !== undefined) {
      const paddingSize = padPacketToSize - ENCRYPTION_OVERHEAD - serialized.length
      const args = [sharedSecret, serialized]
      for (let i = 0; i < Math.floor(paddingSize / 32); i++) {
        args.push(ZERO_BYTES)
      }
      args.push(ZERO_BYTES.slice(0, paddingSize % 32))
      return encrypt.apply(null, args)
    }

    return encrypt(sharedSecret, serialized)
  }

  /** @private */
  _serialize (): Buffer {
    const writer = new Writer()
    this.writeTo(writer)
    return writer.getBuffer()
  }

  writeTo (writer: Writer): void {
    writer.writeUInt8(VERSION)
    writer.writeUInt8(this.ilpPacketType)
    writer.writeVarUInt(this.sequence)
    writer.writeVarUInt(this.prepareAmount)
    // Write the number of frames (excluding padding)
    writer.writeVarUInt(this.frames.length)
    for (let frame of this.frames) {
      frame.writeTo(writer)
    }
  }

  byteLength (): number {
    const predictor = new Predictor()
    this.writeTo(predictor)
    return predictor.getSize() + ENCRYPTION_OVERHEAD
  }
}

export enum FrameType {
  Padding = 0x00,

  ConnectionClose = 0x01,
  ConnectionNewAddress = 0x02,
  ConnectionMaxData = 0x03,
  ConnectionDataBlocked = 0x04,
  ConnectionMaxStreamId = 0x05,
  ConnectionStreamIdBlocked = 0x06,

  StreamClose = 0x10,
  StreamMoney = 0x11,
  StreamMaxMoney = 0x12,
  StreamMoneyBlocked = 0x13,
  StreamData = 0x14,
  StreamMaxData = 0x15,
  StreamDataBlocked = 0x16
}

export enum ErrorCode {
  NoError = 0x01,
  InternalError = 0x02,
  ServerBusy = 0x03,
  FlowControlError = 0x04,
  StreamIdError = 0x05,
  StreamStateError = 0x06,
  FinalOffsetError = 0x07,
  FrameFormatError = 0x08,
  ProtocolViolation = 0x09,
  ApplicationError = 0x0a
  // TODO add frame-specific errors
}

export abstract class BaseFrame {
  type: FrameType
  name: string

  constructor (name: keyof typeof FrameType) {
    this.type = FrameType[name]
    this.name = name
  }

  static fromBuffer (reader: Reader): BaseFrame {
    throw new Error(`class method "fromBuffer" is not implemented`)
  }

  abstract writeTo (writer: Writer): Writer

  byteLength (): number {
    const predictor = new Predictor()
    this.writeTo(predictor)
    return predictor.getSize()
  }
}

export type Frame =
  ConnectionCloseFrame
  | ConnectionNewAddressFrame
  | ConnectionMaxDataFrame
  | ConnectionDataBlockedFrame
  | ConnectionMaxStreamIdFrame
  | ConnectionStreamIdBlockedFrame
  | StreamMoneyFrame
  | StreamMaxMoneyFrame
  | StreamMoneyBlockedFrame
  | StreamCloseFrame
  | StreamDataFrame
  | StreamMaxDataFrame
  | StreamDataBlockedFrame

function assertType (reader: Reader, frameType: keyof typeof FrameType): void {
  const type = reader.readUInt8BigNum().toNumber()
  if (type !== FrameType[frameType]) {
    throw new Error(`Cannot read ${frameType} (${FrameType[frameType]}) from Buffer. Got type: ${type} instead`)
  }
}

export class ConnectionNewAddressFrame extends BaseFrame {
  type: FrameType.ConnectionNewAddress
  sourceAccount: string

  constructor (sourceAccount: string) {
    super('ConnectionNewAddress')
    this.sourceAccount = sourceAccount
  }

  static fromBuffer (reader: Reader): ConnectionNewAddressFrame {
    assertType(reader, 'ConnectionNewAddress')
    const contents = Reader.from(reader.readVarOctetString())
    const sourceAccount = contents.readVarOctetString().toString('utf8')
    return new ConnectionNewAddressFrame(sourceAccount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarOctetString(Buffer.from(this.sourceAccount))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class ConnectionCloseFrame extends BaseFrame {
  type: FrameType.ConnectionClose
  errorCode: keyof typeof ErrorCode
  errorMessage: string

  constructor (errorCode: ErrorCode | keyof typeof ErrorCode, errorMessage: string) {
    super('ConnectionClose')
    this.errorCode = (typeof errorCode === 'string' ? errorCode : ErrorCode[errorCode] as keyof typeof ErrorCode)
    this.errorMessage = errorMessage
  }

  static fromBuffer (reader: Reader): ConnectionCloseFrame {
    assertType(reader, 'ConnectionClose')
    const contents = Reader.from(reader.readVarOctetString())
    const errorCode = ErrorCode[contents.readUInt8BigNum().toNumber()] as keyof typeof ErrorCode
    const errorMessage = contents.readVarOctetString().toString()
    return new ConnectionCloseFrame(errorCode, errorMessage)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeUInt8(ErrorCode[this.errorCode])
    contents.writeVarOctetString(Buffer.from(this.errorMessage))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class ConnectionMaxDataFrame extends BaseFrame {
  type: FrameType.ConnectionMaxData
  maxOffset: BigNumber

  constructor (maxOffset: BigNumber.Value) {
    super('ConnectionMaxData')
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromBuffer (reader: Reader): ConnectionMaxDataFrame {
    assertType(reader, 'ConnectionMaxData')
    const contents = Reader.from(reader.readVarOctetString())
    const maxOffset = contents.readVarUIntBigNum()
    return new ConnectionMaxDataFrame(maxOffset)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.maxOffset)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class ConnectionDataBlockedFrame extends BaseFrame {
  type: FrameType.ConnectionDataBlocked
  maxOffset: BigNumber

  constructor (maxOffset: BigNumber.Value) {
    super('ConnectionDataBlocked')
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromBuffer (reader: Reader): ConnectionDataBlockedFrame {
    assertType(reader, 'ConnectionDataBlocked')
    const contents = Reader.from(reader.readVarOctetString())
    const maxOffset = contents.readVarUIntBigNum()
    return new ConnectionDataBlockedFrame(maxOffset)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.maxOffset)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class ConnectionMaxStreamIdFrame extends BaseFrame {
  type: FrameType.ConnectionMaxStreamId
  maxStreamId: BigNumber

  constructor (maxStreamId: BigNumber.Value) {
    super('ConnectionMaxStreamId')
    this.maxStreamId = new BigNumber(maxStreamId)
  }

  static fromBuffer (reader: Reader): ConnectionMaxStreamIdFrame {
    assertType(reader, 'ConnectionMaxStreamId')
    const contents = Reader.from(reader.readVarOctetString())
    const maxStreamId = contents.readVarUIntBigNum()
    return new ConnectionMaxStreamIdFrame(maxStreamId)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.maxStreamId)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class ConnectionStreamIdBlockedFrame extends BaseFrame {
  type: FrameType.ConnectionStreamIdBlocked
  maxStreamId: BigNumber

  constructor (maxStreamId: BigNumber.Value) {
    super('ConnectionStreamIdBlocked')
    this.maxStreamId = new BigNumber(maxStreamId)
  }

  static fromBuffer (reader: Reader): ConnectionStreamIdBlockedFrame {
    assertType(reader, 'ConnectionStreamIdBlocked')
    const contents = Reader.from(reader.readVarOctetString())
    const maxStreamId = contents.readVarUIntBigNum()
    return new ConnectionStreamIdBlockedFrame(maxStreamId)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.maxStreamId)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamMoneyFrame extends BaseFrame {
  type: FrameType.StreamMoney
  streamId: BigNumber
  shares: BigNumber

  constructor (streamId: BigNumber.Value, shares: BigNumber.Value) {
    super('StreamMoney')
    this.streamId = new BigNumber(streamId)
    this.shares = new BigNumber(shares)

    assert(this.shares.isInteger() && this.shares.isPositive(), `shares must be a positive integer: ${shares}`)
  }

  static fromBuffer (reader: Reader): StreamMoneyFrame {
    assertType(reader, 'StreamMoney')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const amount = contents.readVarUIntBigNum()
    return new StreamMoneyFrame(streamId, amount)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.shares)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamMaxMoneyFrame extends BaseFrame {
  type: FrameType.StreamMaxMoney
  streamId: BigNumber
  receiveMax: BigNumber
  totalReceived: BigNumber

  constructor (streamId: BigNumber.Value, receiveMax: BigNumber.Value, totalReceived: BigNumber.Value) {
    super('StreamMaxMoney')
    this.streamId = new BigNumber(streamId)
    this.receiveMax = new BigNumber(receiveMax)
    this.totalReceived = new BigNumber(totalReceived)

    if (!this.receiveMax.isFinite()) {
      this.receiveMax = MAX_UINT64
    }

    assert(this.receiveMax.isInteger() && this.receiveMax.isPositive(), `receiveMax must be a positive integer. got: ${receiveMax}`)
    assert(this.totalReceived.isInteger() && this.totalReceived.isPositive(), `totalReceived must be a positive integer. got: ${totalReceived}`)
  }

  static fromBuffer (reader: Reader): StreamMaxMoneyFrame {
    assertType(reader, 'StreamMaxMoney')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const receiveMax = contents.readVarUIntBigNum()
    const totalReceived = contents.readVarUIntBigNum()
    return new StreamMaxMoneyFrame(streamId, receiveMax, totalReceived)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.receiveMax)
    contents.writeVarUInt(this.totalReceived)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamMoneyBlockedFrame extends BaseFrame {
  type: FrameType.StreamMoneyBlocked
  streamId: BigNumber
  sendMax: BigNumber
  totalSent: BigNumber

  constructor (streamId: BigNumber.Value, sendMax: BigNumber.Value, totalSent: BigNumber.Value) {
    super('StreamMoneyBlocked')
    this.streamId = new BigNumber(streamId)
    this.sendMax = new BigNumber(sendMax)
    this.totalSent = new BigNumber(totalSent)

    assert(this.sendMax.isInteger() && this.sendMax.isPositive(), `sendMax must be a positive integer. got: ${sendMax}`)
    assert(this.totalSent.isInteger() && this.totalSent.isPositive(), `totalSent must be a positive integer. got: ${totalSent}`)
  }

  static fromBuffer (reader: Reader): StreamMoneyBlockedFrame {
    assertType(reader, 'StreamMoneyBlocked')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const sendMax = contents.readVarUIntBigNum()
    const totalSent = contents.readVarUIntBigNum()
    return new StreamMoneyBlockedFrame(streamId, sendMax, totalSent)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.sendMax)
    contents.writeVarUInt(this.totalSent)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamCloseFrame extends BaseFrame {
  type: FrameType.StreamClose
  streamId: BigNumber
  errorCode: keyof typeof ErrorCode
  errorMessage: string

  constructor (streamId: BigNumber.Value, errorCode: keyof typeof ErrorCode, errorMessage: string) {
    super('StreamClose')
    this.streamId = new BigNumber(streamId)
    this.errorCode = errorCode
    this.errorMessage = errorMessage
  }

  static fromBuffer (reader: Reader): StreamCloseFrame {
    assertType(reader, 'StreamClose')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const errorCode = ErrorCode[contents.readUInt8BigNum().toNumber()] as keyof typeof ErrorCode
    const errorMessage = contents.readVarOctetString().toString('utf8')
    return new StreamCloseFrame(streamId, errorCode, errorMessage)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeUInt8(ErrorCode[this.errorCode])
    contents.writeVarOctetString(Buffer.from(this.errorMessage, 'utf8'))
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamDataFrame extends BaseFrame {
  type: FrameType.StreamData
  streamId: BigNumber
  offset: BigNumber
  data: Buffer

  constructor (streamId: BigNumber.Value, offset: BigNumber.Value, data: Buffer) {
    super('StreamData')
    this.streamId = new BigNumber(streamId)
    this.offset = new BigNumber(offset)
    this.data = data
  }

  static fromBuffer (reader: Reader): StreamDataFrame {
    assertType(reader, 'StreamData')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const offset = contents.readVarUIntBigNum()
    const data = contents.readVarOctetString()
    return new StreamDataFrame(streamId, offset, data)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.offset)
    contents.writeVarOctetString(this.data)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }

  // Leave out the data because that may be very long
  toJSON (): Object {
    return {
      type: this.type,
      name: this.name,
      streamId: this.streamId,
      offset: this.offset,
      dataLength: this.data.length
    }
  }
}

export class StreamMaxDataFrame extends BaseFrame {
  type: FrameType.StreamMaxData
  streamId: BigNumber
  maxOffset: BigNumber

  constructor (streamId: BigNumber.Value, maxOffset: BigNumber.Value) {
    super('StreamMaxData')
    this.streamId = new BigNumber(streamId)
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromBuffer (reader: Reader): StreamMaxDataFrame {
    assertType(reader, 'StreamMaxData')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const maxOffset = contents.readVarUIntBigNum()
    return new StreamMaxDataFrame(streamId, maxOffset)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.maxOffset)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

export class StreamDataBlockedFrame extends BaseFrame {
  type: FrameType.StreamDataBlocked
  streamId: BigNumber
  maxOffset: BigNumber

  constructor (streamId: BigNumber.Value, maxOffset: BigNumber.Value) {
    super('StreamDataBlocked')
    this.streamId = new BigNumber(streamId)
    this.maxOffset = new BigNumber(maxOffset)
  }

  static fromBuffer (reader: Reader): StreamDataBlockedFrame {
    assertType(reader, 'StreamDataBlocked')
    const contents = Reader.from(reader.readVarOctetString())
    const streamId = contents.readVarUIntBigNum()
    const maxOffset = contents.readVarUIntBigNum()
    return new StreamDataBlockedFrame(streamId, maxOffset)
  }

  writeTo (writer: Writer): Writer {
    writer.writeUInt8(this.type)
    const contents = new Writer()
    contents.writeVarUInt(this.streamId)
    contents.writeVarUInt(this.maxOffset)
    writer.writeVarOctetString(contents.getBuffer())
    return writer
  }
}

function parseFrame (reader: Reader): Frame | undefined {
  const type = reader.peekUInt8BigNum().toNumber()

  switch (type) {
    case FrameType.ConnectionClose:
      return ConnectionCloseFrame.fromBuffer(reader)
    case FrameType.ConnectionNewAddress:
      return ConnectionNewAddressFrame.fromBuffer(reader)
    case FrameType.ConnectionMaxData:
      return ConnectionMaxDataFrame.fromBuffer(reader)
    case FrameType.ConnectionDataBlocked:
      return ConnectionDataBlockedFrame.fromBuffer(reader)
    case FrameType.ConnectionMaxStreamId:
      return ConnectionMaxStreamIdFrame.fromBuffer(reader)
    case FrameType.ConnectionStreamIdBlocked:
      return ConnectionStreamIdBlockedFrame.fromBuffer(reader)
    case FrameType.StreamClose:
      return StreamCloseFrame.fromBuffer(reader)
    case FrameType.StreamMoney:
      return StreamMoneyFrame.fromBuffer(reader)
    case FrameType.StreamMaxMoney:
      return StreamMaxMoneyFrame.fromBuffer(reader)
    case FrameType.StreamMoneyBlocked:
      return StreamMoneyBlockedFrame.fromBuffer(reader)
    case FrameType.StreamData:
      return StreamDataFrame.fromBuffer(reader)
    case FrameType.StreamMaxData:
      return StreamMaxDataFrame.fromBuffer(reader)
    case FrameType.StreamDataBlocked:
      return StreamDataBlockedFrame.fromBuffer(reader)
    default:
      reader.skipUInt8()
      reader.skipVarOctetString()
      return undefined
  }
}
