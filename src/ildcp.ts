import * as IlpPacket from 'ilp-packet'
import { Reader } from 'oer-utils'

const debug = require('debug')('ilp-protocol-ildcp')

const PEER_PROTOCOL_FULFILLMENT = Buffer.alloc(32)
const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')
const PEER_PROTOCOL_EXPIRY_DURATION = 60000

export interface IldcpResponse {
  clientAddress: string,
  assetScale: number,
  assetCode: string
}

const deserializeIldcpResponse = (response: Buffer): IldcpResponse => {
  const { fulfillment, data } = IlpPacket.deserializeIlpFulfill(response)

  if (!PEER_PROTOCOL_FULFILLMENT.equals(fulfillment)) {
    throw new Error('IL-DCP response does not contain the expected fulfillment.')
  }

  const reader = Reader.from(data)

  const clientAddress = reader.readVarOctetString().toString('ascii')

  const assetScale = reader.readUInt8Number()
  const assetCode = reader.readVarOctetString().toString('utf8')

  return { clientAddress, assetScale, assetCode }
}

const fetch = async (sendData: (data: Buffer) => Promise<Buffer>, getNetworkTimeMs?: () => Promise<number>): Promise<IldcpResponse> => {
  const netTime = (getNetworkTimeMs ? await getNetworkTimeMs() : Date.now()) + PEER_PROTOCOL_EXPIRY_DURATION
  const data = await sendData(IlpPacket.serializeIlpPrepare({
    amount: '0',
    executionCondition: PEER_PROTOCOL_CONDITION,
    expiresAt: new Date(netTime),
    destination: 'peer.config',
    data: Buffer.alloc(0)
  }))

  if (data[0] === IlpPacket.Type.TYPE_ILP_REJECT) {
    const { triggeredBy, message } = IlpPacket.deserializeIlpReject(data)
    debug('IL-DCP request rejected. triggeredBy=%s errorMessage=%s', triggeredBy, message)
    throw new Error('IL-DCP failed: ' + message)
  } else if (data[0] !== IlpPacket.Type.TYPE_ILP_FULFILL) {
    debug('invalid response type. type=%s', data[0])
    throw new Error('IL-DCP error, unable to retrieve client configuration.')
  }

  const { clientAddress, assetScale, assetCode } = deserializeIldcpResponse(data)

  debug('received client info. clientAddress=%s assetScale=%s assetCode=%s', clientAddress, assetScale, assetCode)

  return { clientAddress, assetScale, assetCode }
}

export {
    fetch,
}
