import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroIllustration } from '../components/HeroIllustration'

describe('HeroIllustration', () => {
  it('renders as an accessible image labeled "Herold"', () => {
    render(<HeroIllustration size={100} />)
    expect(screen.getByRole('img', { name: 'Herold' })).toBeInTheDocument()
  })
})
