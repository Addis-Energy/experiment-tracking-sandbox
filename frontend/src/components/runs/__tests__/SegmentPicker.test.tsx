import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RunSegment } from '@/api/runs'
import type { RunView } from '../runView'
import { SegmentPicker } from '../SegmentPicker'

const seg = (id: string, over: Partial<RunSegment> = {}): RunSegment => ({
  id: 1, experiment_id: id, status: 'COMPLETED', date: null, parent_experiment_id: null,
  is_variant: false, description: null, conditions_id: null, pore_volume_mL: null,
  rock_mass_g: null, reactor_slot: null, ...over,
})

const view = (over: Partial<RunView> = {}): RunView => ({
  tab: 'results', segmentId: 'HPHT_297', explicit: false, only: false, ...over,
})

const two = [seg('HPHT_297'), seg('HPHT_297-2', { status: 'ONGOING' })]

function renderPicker(segments: RunSegment[], v: RunView) {
  return render(
    <MemoryRouter initialEntries={['/hpht/HPHT_297?tab=notes']}>
      <SegmentPicker segments={segments} view={v} />
    </MemoryRouter>,
  )
}

describe('SegmentPicker', () => {
  it('renders nothing for a single-segment run', () => {
    const { container } = renderPicker([seg('HPHT_304')], view({ segmentId: 'HPHT_304', explicit: false }))
    expect(container).toBeEmptyDOMElement()
  })

  it('lists Whole run and every segment as links that keep the tab', () => {
    renderPicker(two, view({ segmentId: 'HPHT_297-2', explicit: false, tab: 'notes' }))
    expect(screen.getByRole('link', { name: 'Whole run' })).toHaveAttribute('href', '/hpht/HPHT_297?tab=notes')
    expect(screen.getByRole('link', { name: 'HPHT_297-2' })).toHaveAttribute('href', '/hpht/HPHT_297?segment=HPHT_297-2&tab=notes')
    expect(screen.getByRole('link', { name: 'Whole run' })).toHaveAttribute('aria-current', 'true')
  })

  it('marks the explicit segment current and offers the only toggle', () => {
    renderPicker(two, view({ segmentId: 'HPHT_297', explicit: true }))
    expect(screen.getByRole('link', { name: 'HPHT_297' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: 'Whole run' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: "Only this segment's samples" })).toHaveAttribute('href', expect.stringContaining('only=1'))
  })

  it('offers all samples again while the only toggle is on', () => {
    renderPicker(two, view({ segmentId: 'HPHT_297', explicit: true, only: true }))
    expect(screen.getByRole('link', { name: "All of the run's samples" }).getAttribute('href')).not.toContain('only=1')
  })

  it('hides the only toggle while Whole run is current', () => {
    renderPicker(two, view({ segmentId: 'HPHT_297-2', explicit: false }))
    expect(screen.queryByRole('link', { name: /only this segment/i })).not.toBeInTheDocument()
  })

  it('hides the only toggle for a side sample (variant)', () => {
    const withVariant = [...two, seg('HPHT_297-2_Desorption', { is_variant: true })]
    renderPicker(withVariant, view({ segmentId: 'HPHT_297-2_Desorption', explicit: true }))
    expect(screen.getByRole('link', { name: 'HPHT_297-2_Desorption' })).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('link', { name: /only this segment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /all of the run/i })).not.toBeInTheDocument()
  })

  it('badges ongoing segments', () => {
    renderPicker(two, view())
    expect(screen.getAllByText('Ongoing')).toHaveLength(1)
  })
})
