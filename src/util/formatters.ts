import { formatters } from 'ilp-logger'

formatters.h = (v: Buffer): string => v.toString('hex')
formatters.s = (v: Buffer): string => v.toString()
