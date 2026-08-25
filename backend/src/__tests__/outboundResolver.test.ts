import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookupMock = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { OutboundAddressError, resolveOutboundHost } from '../lib/outboundResolver.js'

beforeEach(() => {
  lookupMock.mockReset()
  delete process.env['HEROLD_OUTBOUND_HOST_ALLOWLIST']
  delete process.env['HEROLD_OUTBOUND_CIDR_ALLOWLIST']
})

describe('resolveOutboundHost', () => {
  it('rejects private and mixed public/private DNS answers', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(resolveOutboundHost('mail.example.com')).rejects.toBeInstanceOf(OutboundAddressError)
  })

  it('pins a validated public answer into the socket lookup', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    const resolved = await resolveOutboundHost('mail.example.com')
    const callback = vi.fn()
    resolved.lookup('mail.example.com', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4)
  })

  it('allows a private answer only through an operator hostname or CIDR allowlist', async () => {
    process.env['HEROLD_OUTBOUND_HOST_ALLOWLIST'] = '*.example.com'
    lookupMock.mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }])
    await expect(resolveOutboundHost('imap.example.com')).resolves.toMatchObject({ address: '10.1.2.3' })

    delete process.env['HEROLD_OUTBOUND_HOST_ALLOWLIST']
    process.env['HEROLD_OUTBOUND_CIDR_ALLOWLIST'] = '10.1.0.0/16'
    lookupMock.mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }])
    await expect(resolveOutboundHost('private.invalid')).resolves.toMatchObject({ address: '10.1.2.3' })
  })
})
