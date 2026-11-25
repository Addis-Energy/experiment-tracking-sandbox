import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/ui'

vi.mock('@/api/experiments', () => ({
  experimentsApi: { get: vi.fn(), getResults: vi.fn() },
}))
vi.mock('@/api/conditions', () => ({
  conditionsApi: { getByExperiment: vi.fn() },
}))

import { experimentsApi } from '@/api/experiments'
import type { ExperimentDetail } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import type { RunView } from '../runView'
import { RunTabs } from '../RunTabs'

const view = (over: Partial<RunView> = {}): RunView => ({
  tab: 'main', segmentId: 'HPHT_297', explicit: false, only: false, ...over,
})

const note = (id: number) => ({ id, note_type: 'observation', note_text: `n${id}`, created_by: null })

const detail = {
  id: 7, experiment_id: 'HPHT_297-2', experiment_number: 297, status: 'ONGOING',
  researcher: null, date: null, sample_id: null, base_experiment_id: 'HPHT_297',
  parent_experiment_fk: null, replicate_label: null, is_outlier: false,
  id_timepoint_days: null, created_at: '2026-07-01T00:00:00Z', updated_at: null,
  conditions: null, notes: [note(1), note(2), note(3), note(4)], modifications: [],
} as unknown as ExperimentDetail

function renderTabs(v: RunView, results: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/hpht/HPHT_297']}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/hpht/:base" element={<RunTabs view={v} results={results} />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(experimentsApi.get).mockResolvedValue(detail)
  vi.mocked(conditionsApi.getByExperiment).mockRejectedValue(new Error('none'))
})

describe('RunTabs', () => {
  it('Main stacks results, the segment conditions and XRD, in that order', async () => {
    renderTabs(view({ segmentId: 'HPHT_297-2' }), <p>RESULTS</p>)
    const results = screen.getByText('RESULTS')
    const conditions = await screen.findByText('No conditions recorded for this experiment.')
    const xrd = await screen.findByText('No external analyses linked')
    expect(results.compareDocumentPosition(conditions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(conditions.compareDocumentPosition(xrd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('XRD of HPHT_297-2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Main' })).toHaveAttribute('aria-current', 'page')
  })

  it('lists the tabs in order: Main, the three sections, then Notes and Entry Logs', () => {
    renderTabs(view(), null)
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(
      ['Main', 'Results', 'Conditions', 'XRD', 'Notes', 'Entry Logs'],
    )
  })

  describe('section tabs scroll Main to their section', () => {
    const scroll = vi.fn()
    beforeEach(() => {
      scroll.mockReset()
      Element.prototype.scrollIntoView = scroll
    })
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    })

    it.each(['results', 'conditions', 'xrd'] as const)('%s shows Main and scrolls to its section', async (tab) => {
      renderTabs(view({ tab, segmentId: 'HPHT_297-2' }), <p>RESULTS</p>)
      expect(screen.getByText('RESULTS')).toBeInTheDocument()
      await waitFor(() => expect(scroll).toHaveBeenCalled())
      expect((scroll.mock.instances[0] as HTMLElement).id).toBe(`section-${tab}`)
      expect(screen.getByRole('link', { name: new RegExp(`^${tab}$`, 'i') })).toHaveAttribute('aria-current', 'page')
    })

    it('Main itself, Notes and Entry Logs never scroll', async () => {
      for (const tab of ['main', 'notes', 'logs'] as const) {
        const { unmount } = renderTabs(view({ tab, segmentId: 'HPHT_297-2' }), null)
        await screen.findByRole('link', { name: /Notes\s*4/ })
        unmount()
      }
      expect(scroll).not.toHaveBeenCalled()
    })
  })

  it('loads the selected segment for the notes tab and counts its notes on the tab', async () => {
    renderTabs(view({ tab: 'notes', segmentId: 'HPHT_297-2' }), <p>RESULTS</p>)
    await waitFor(() => expect(experimentsApi.get).toHaveBeenCalledWith('HPHT_297-2'))
    expect(screen.queryByText('RESULTS')).not.toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Notes\s*4/ })).toHaveAttribute('aria-current', 'page')
  })

  it('names the segment the record tabs belong to', async () => {
    renderTabs(view({ tab: 'conditions', segmentId: 'HPHT_297-2' }), null)
    expect(await screen.findByText(/Conditions of HPHT_297-2/)).toBeInTheDocument()
  })

  it('F7: says so when the segment cannot be loaded, instead of spinning', async () => {
    vi.mocked(experimentsApi.get).mockRejectedValue(new Error('boom'))
    renderTabs(view({ tab: 'notes', segmentId: 'HPHT_297-2' }), null)
    expect(await screen.findByText('Could not load HPHT_297-2.')).toBeInTheDocument()
  })

  it('F7: waits for the conditions query before rendering the Conditions tab', async () => {
    let settle: (v: never) => void = () => {}
    vi.mocked(conditionsApi.getByExperiment).mockImplementation(
      () => new Promise((resolve) => { settle = resolve as (v: never) => void }),
    )
    renderTabs(view({ tab: 'conditions', segmentId: 'HPHT_297-2' }), null)
    // The segment has loaded (its notes count shows) while conditions are still pending.
    await screen.findByRole('link', { name: /Notes\s*4/ })
    expect(screen.queryByText('No conditions recorded for this experiment.')).not.toBeInTheDocument()
    settle(null as never)
    expect(await screen.findByText('No conditions recorded for this experiment.')).toBeInTheDocument()
  })

  it('links each tab by ?tab= and omits it for Main', async () => {
    renderTabs(view({ segmentId: 'HPHT_297-2' }), null)
    expect(screen.getByRole('link', { name: 'Main' })).toHaveAttribute('href', '/hpht/HPHT_297')
    expect(screen.getByRole('link', { name: /^Results/ })).toHaveAttribute('href', '/hpht/HPHT_297?tab=results')
    expect(screen.getByRole('link', { name: /^XRD/ })).toHaveAttribute('href', '/hpht/HPHT_297?tab=xrd')
    expect(await screen.findByRole('link', { name: /Notes\s*4/ })).toHaveAttribute('href', '/hpht/HPHT_297?tab=notes')
  })
})
