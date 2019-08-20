import BigNumber from 'bignumber.js'
import * as Packet from '../src/packet'

const MAX_UINT_64 = new BigNumber('18446744073709551615')
const NUMBERS = [
  { name: '0', value: 0 },
  { name: 'max_js', value: Number.MAX_SAFE_INTEGER },
  { name: 'max_uint_64', value: MAX_UINT_64 }
]

Packet.StreamDataFrame.prototype.toJSON = function () {
  return {
    type: this.type,
    name: this.name,
    streamId: this.streamId,
    offset: this.offset,
    data: this.data.toString('base64')
  }
}

const variants = Array.prototype.concat.apply([], [
  NUMBERS.map((pair) => ({ name: 'sequence:' + pair.name, sequence: pair.value })),
  { name: 'type:prepare', packetType: Packet.IlpPacketType.Prepare },
  { name: 'type:fulfill', packetType: Packet.IlpPacketType.Fulfill },
  { name: 'type:reject', packetType: Packet.IlpPacketType.Reject },
  NUMBERS.map((pair) => ({ name: 'amount:' + pair.name, amount: pair.value })),

  // TODO test too-large-for-u64
  {
    name: 'frame:connection_close',
    frame: new Packet.ConnectionCloseFrame(0x01, 'fail')
  },
  {
    name: 'frame:connection_new_address:empty',
    frame: new Packet.ConnectionNewAddressFrame('')
  },
  {
    name: 'frame:connection_new_address',
    frame: new Packet.ConnectionNewAddressFrame('example.alice')
  },
  {
    name: 'frame:connection_asset_details',
    frame: new Packet.ConnectionAssetDetailsFrame('ABC', 256 - 1)
  },

  NUMBERS.map((pair) => ({
    name: 'frame:connection_max_data:' + pair.name,
    frame: new Packet.ConnectionMaxDataFrame(pair.value)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:connection_data_blocked:' + pair.name,
    frame: new Packet.ConnectionDataBlockedFrame(pair.value)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:connection_max_stream_id:' + pair.name,
    frame: new Packet.ConnectionMaxStreamIdFrame(pair.value)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:connection_stream_id_blocked:' + pair.name,
    frame: new Packet.ConnectionStreamIdBlockedFrame(pair.value)
  })),

  {
    name: 'frame:stream_close',
    frame: new Packet.StreamCloseFrame(123, 256 - 1, 'an error message')
  },

  NUMBERS.map((pair) => ({
    name: 'frame:stream_money:' + pair.name,
    frame: new Packet.StreamMoneyFrame(123, pair.value)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:stream_max_money:received_max:' + pair.name,
    frame: new Packet.StreamMaxMoneyFrame(123, pair.value, 456)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:stream_max_money:total_received:' + pair.name,
    frame: new Packet.StreamMaxMoneyFrame(123, 456, pair.value)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:stream_money_blocked:send_max:' + pair.name,
    frame: new Packet.StreamMoneyBlockedFrame(123, pair.value, 456)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:stream_money_blocked:total_sent:' + pair.name,
    frame: new Packet.StreamMoneyBlockedFrame(123, 456, pair.value)
  })),

  {
    name: 'frame:stream_data',
    frame: new Packet.StreamDataFrame(123, 456, Buffer.from('foobar'))
  },
  NUMBERS.map((pair) => ({
    name: 'frame:stream_data:offset:' + pair.name,
    frame: new Packet.StreamDataFrame(123, pair.value, Buffer.alloc(0))
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:stream_max_data:offset:' + pair.name,
    frame: new Packet.StreamMaxDataFrame(123, pair.value)
  })),
  NUMBERS.map((pair) => ({
    name: 'frame:stream_data_blocked:offset:' + pair.name,
    frame: new Packet.StreamDataBlockedFrame(123, pair.value)
  }))
])

const fixtures = variants.map(function (params: any) {
  const packetOptions: {
    sequence: string,
    packetType: Packet.IlpPacketType,
    amount: string,
    frames: Packet.Frame[]
  } = {
    sequence: '0',
    packetType: Packet.IlpPacketType.Prepare,
    amount: '0',
    frames: []
  }

  if (params.sequence !== undefined) packetOptions.sequence = params.sequence.toString()
  if (params.packetType !== undefined) packetOptions.packetType = params.packetType
  if (params.amount !== undefined) packetOptions.amount = params.amount.toString()
  if (params.frame) packetOptions.frames.push(params.frame)

  const packet = new Packet.Packet(
    packetOptions.sequence,
    packetOptions.packetType,
    packetOptions.amount,
    packetOptions.frames
  )

  return {
    name: params.name,
    packet: packetOptions,
    buffer: packet._serialize().toString('base64')
  }
})

console.log(JSON.stringify(fixtures, null, '  '))
