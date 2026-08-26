import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AuthUser } from '../hooks/useAuth'
import { Header } from '../components/Header'
import { setAccessToken } from '../lib/api'

const configuredGlockeUrl = 'https://GLOCKE.example.com:443/'
const glockeUrl = 'https://glocke.example.com'
const mockUser: AuthUser = { id: '1', email: 'user@example.com', name: 'User', role: 'user' }

function unreadResponse(count: number): Response {
  return new Response(JSON.stringify({ count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function profileResponse(): Response {
  return new Response(JSON.stringify({ avatarDataUrl: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function routedFetch(unreadHandler: () => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/auth/profile')) return Promise.resolve(profileResponse())
    return Promise.resolve(unreadHandler())
  })
}

async function renderHeader() {
  setAccessToken('memory-token')
  render(<Header user={mockUser} onLogout={vi.fn()} onOpenMobileMenu={vi.fn()} />)
}

beforeEach(() => {
  window.__HOF_CONFIG__ = { schemaVersion: 1, glockeUrl: configuredGlockeUrl }
})

afterEach(() => {
  cleanup()
  setAccessToken(null)
  delete window.__HOF_CONFIG__
  vi.unstubAllGlobals()
})

describe('Header bell gated on Glocke topology', () => {
  it('renders the bell and polls Glocke when services.glocke is enabled (or the field is absent)', async () => {
    vi.stubGlobal('fetch', routedFetch(() => unreadResponse(3)))
    await renderHeader()

    const bell = await screen.findByRole('link', { name: 'Уведомления: непрочитанных — 3' })
    expect(bell).toHaveAttribute('href', `${glockeUrl}/notifications`)
  })

  it('hides the bell and never polls Glocke when services.glocke is false', async () => {
    window.__HOF_CONFIG__ = { schemaVersion: 1, glockeUrl: configuredGlockeUrl, services: { glocke: false } }
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/auth/profile') ? Promise.resolve(profileResponse()) : Promise.reject(new Error('unexpected fetch')),
    )
    vi.stubGlobal('fetch', fetchMock)
    await renderHeader()

    await Promise.resolve()
    expect(screen.queryByRole('link', { name: /уведомления/i })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(glockeUrl))).toBe(false)
  })
})
