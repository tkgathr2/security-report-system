import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { COLORS, WEATHER_LABELS, GUARD_CONTENT_LABELS } from '../constants/admin'

describe('frontend test infra smoke', () => {
  it('loads app constants correctly', () => {
    expect(COLORS.primary).toBe('#E67E22')
    expect(WEATHER_LABELS.sunny).toBe('晴')
    expect(GUARD_CONTENT_LABELS.traffic).toBe('①交通誘導')
  })

  it('renders a component into jsdom with jest-dom matchers', () => {
    render(<div data-testid="smoke">ほうこちゃん</div>)
    const el = screen.getByTestId('smoke')
    expect(el).toBeInTheDocument()
    expect(el).toHaveTextContent('ほうこちゃん')
  })
})
