import { useNavigate } from '@tanstack/react-router'
import { HelpCircle } from 'lucide-react'
import { EmptyState } from '@zudar107/schloss-ui'
import { HeroIllustration } from '../../components/HeroIllustration'

// Platform wiring (auth, header/sidebar, the shared Glocke bell,
// /health+/ready, CI, Docker, the tor gateway entry) lands first and on
// its own - mail account management and the actual mail UI are later
// stages (see Hof/ROADMAP.md's Herold entry). This is the placeholder
// that fills the empty slot until then, in the same illustrated
// "mascot + text" language as every other service's own empty states.
export function HomePage() {
  const navigate = useNavigate()

  return (
    <EmptyState
      illustration={<HeroIllustration size={100} />}
      title="Herold ещё строится"
      description="Подключение почтовых аккаунтов и сама работа с почтой скоро появятся здесь."
      actionLabel="Справка"
      actionIcon={<HelpCircle size={16} />}
      onAction={() => void navigate({ to: '/help' })}
    />
  )
}
