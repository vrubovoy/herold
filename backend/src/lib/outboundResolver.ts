import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'

const BLOCKED_RANGES: Array<[string, number, 'ipv4' | 'ipv6']> = [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'], ['::1', 128, 'ipv6'], ['::ffff:0:0', 96, 'ipv6'],
  ['64:ff9b:1::', 48, 'ipv6'], ['100::', 64, 'ipv6'], ['2001:db8::', 32, 'ipv6'],
  ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'], ['ff00::', 8, 'ipv6'],
]

const blockedV4 = new BlockList()
const blockedV6 = new BlockList()
for (const [network, prefix, family] of BLOCKED_RANGES) {
  (family === 'ipv4' ? blockedV4 : blockedV6).addSubnet(network, prefix, family)
}

function commaList(name: string): string[] {
  return (process.env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean)
}

function hostnameAllowed(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return commaList('HEROLD_OUTBOUND_HOST_ALLOWLIST').some((entry) => {
    const allowed = entry.toLowerCase().replace(/\.$/, '')
    return allowed.startsWith('*.')
      ? normalized.endsWith(allowed.slice(1)) && normalized !== allowed.slice(2)
      : normalized === allowed
  })
}

function cidrAllowed(address: string, family: 4 | 6): boolean {
  const allowlistV4 = new BlockList()
  const allowlistV6 = new BlockList()
  for (const entry of commaList('HEROLD_OUTBOUND_CIDR_ALLOWLIST')) {
    const separator = entry.lastIndexOf('/')
    const network = separator === -1 ? entry : entry.slice(0, separator)
    const networkFamily = isIP(network)
    if (!networkFamily) throw new Error(`Invalid HEROLD_OUTBOUND_CIDR_ALLOWLIST entry: ${entry}`)
    const prefix = separator === -1 ? (networkFamily === 4 ? 32 : 128) : Number(entry.slice(separator + 1))
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (networkFamily === 4 ? 32 : 128)) {
      throw new Error(`Invalid HEROLD_OUTBOUND_CIDR_ALLOWLIST entry: ${entry}`)
    }
    const type = networkFamily === 4 ? 'ipv4' : 'ipv6'
    const allowlist = networkFamily === 4 ? allowlistV4 : allowlistV6
    allowlist.addSubnet(network, prefix, type)
  }
  return (family === 4 ? allowlistV4 : allowlistV6).check(address, family === 4 ? 'ipv4' : 'ipv6')
}

function isPublic(address: string, family: 4 | 6): boolean {
  return !(family === 4 ? blockedV4 : blockedV6).check(address, family === 4 ? 'ipv4' : 'ipv6')
}

export class OutboundAddressError extends Error {
  code = 'EOUTBOUND'

  constructor(hostname: string) {
    super(`Outbound address is not permitted: ${hostname}`)
    this.name = 'OutboundAddressError'
  }
}

export interface ResolvedOutboundHost {
  address: string
  family: 4 | 6
  lookup: LookupFunction
}

export async function resolveOutboundHost(hostname: string): Promise<ResolvedOutboundHost> {
  const normalized = hostname.trim().replace(/^\[|\]$/g, '')
  const literalFamily = isIP(normalized)
  const addresses = literalFamily
    ? [{ address: normalized, family: literalFamily as 4 | 6 }]
    : await dnsLookup(normalized, { all: true, verbatim: true }) as Array<{ address: string; family: 4 | 6 }>

  if (addresses.length === 0) throw new OutboundAddressError(hostname)
  const hostAllowed = hostnameAllowed(normalized)
  if (!addresses.every(({ address, family }) => {
    const addressAllowed = cidrAllowed(address, family)
    return hostAllowed || isPublic(address, family) || addressAllowed
  })) {
    throw new OutboundAddressError(hostname)
  }

  const pinned = addresses[0]!
  const lookup: LookupFunction = (_requestedHost, options, callback) => {
    if (typeof options === 'object' && options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }])
      return
    }
    callback(null, pinned.address, pinned.family)
  }
  return { ...pinned, lookup }
}
