import { useState } from 'react'
import { Menu } from 'lucide-react'
import {
  Header as SharedHeader,
  normalizeNotificationOrigin,
  ThemeToggle,
  useAvatarUrl,
  useUnreadNotifications,
} from '@zudar107/schloss-ui'
import { buildSchluesselAccountUrl } from '../lib/authRedirect'
import { apiClient } from '../lib/api'
import type { AuthUser } from '../hooks/useAuth'
import { getRuntimeConfig } from '../lib/runtimeConfig'

interface HeaderProps {
  user: AuthUser | null
  onLogout: () => void | Promise<void>
  onOpenMobileMenu: () => void
}

// Always visible (desktop and mobile) - the sidebar (which carries
// identity/settings/logout) is hidden below the mobile breakpoint, so
// this sits alongside its own controls rather than replacing them.
//
// The notification bell is wired up like every other app's, even though
// Herold itself never emits a Glocke event - a user should be able to
// see and jump to a notification from Kuvert/Tafel/Zettel/etc. no matter
// which app they're currently in, not only from the one that raised it.
export function Header({ user, onLogout, onOpenMobileMenu }: HeaderProps) {
  const [loggingOut, setLoggingOut] = useState(false)
  const { schlossUrl, glockeUrl, schlusselUrl } = getRuntimeConfig()
  const notificationOrigin = normalizeNotificationOrigin(glockeUrl)
  const notificationState = useUnreadNotifications({
    glockeOrigin: glockeUrl,
    userId: loggingOut ? null : user?.id ?? null,
    apiClient,
  })
  const avatarUrl = useAvatarUrl({
    schluesselOrigin: schlusselUrl,
    userId: loggingOut ? null : user?.id ?? null,
    apiClient,
  })

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await onLogout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <SharedHeader
      // The home link leads to schloss (Herold has no home page of its
      // own), so the badge shows schloss's own logo mark, not Herold's -
      // it should look like it goes to a different app, not display
      // Herold's identity in a slot meant for "where this link goes".
      logo={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      }
      homeHref={schlossUrl}
      homeTitle="На главную"
      user={user ? { ...user, avatarUrl } : null}
      // The header's gear icon opens the platform-wide account settings
      // hosted on schlussel (password, delete account, ...) - NOT
      // Herold's own /settings route, which is service-specific
      // preferences and stays reachable from the sidebar.
      onSettings={() => { window.location.href = buildSchluesselAccountUrl(window.location.pathname) }}
      onLogout={handleLogout}
      notifications={user && !loggingOut && notificationOrigin
        ? { href: `${notificationOrigin}/notifications`, state: notificationState, glockeOrigin: notificationOrigin, apiClient }
        : undefined}
      rightSlot={<ThemeToggle />}
      leftSlot={
        <button
          onClick={onOpenMobileMenu}
          className="show-mobile"
          aria-label="Меню"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }}
        >
          <Menu size={20} />
        </button>
      }
    />
  )
}
