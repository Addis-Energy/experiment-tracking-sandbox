// Task 3 of one-page-per-run: the detail page's header, extracted so the run
// pages can host it. The detail-page behaviour is covered by the pages/ExperimentDetail tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'

vi.mock('@/api/experiments', async () => {
  const actual = await vi.importActual<typeof import('@/api/experiments')>('@/api/experiments')
  return {
    ...actual,
    experimentsApi: {
      get: vi.fn(),
      patch: vi.fn(),
      patchStatus: vi.fn(),
      getDeleteImpact: vi.fn(),
      delete: vi.fn(),
      addNote: vi.fn(),
      patchNote: vi.fn(),
    },
  }
})
vi.mock('@/hooks/useExperimentIdValidation', () => ({
  useExperimentIdValidation: () => ({ status: 'idle' }),
}))

import { ExperimentRecordHeader, type ExperimentRecordHeaderProps } from '../ExperimentRecordHeader'
import { experimentsApi } from '@/api/experiments'
import type { ExperimentDetail } from '@/api/experiments'
import type { ConditionsResponse } from '@/api/conditions'

const EXP: ExperimentDetail = {
  id: 70,
  experiment_id: 'HPHT_297-2',
  experiment_number: 297,
  status: 'ONGOING',
  researcher: null,
  date: null,
  sample_id: null,
  base_experiment_id: 'HPHT_297',
  parent_experiment_fk: null,
  replicate_label: null,
  is_outlier: false,
  id_timepoint_days: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: null,
  conditions: null,
  notes: [],
  modifications: [],
}

const CONDITIONS = {
  experiment_type: 'HPHT', reactor_number: 9, reactor_slot: 'R09',
} as ConditionsResponse

const user = userEvent.setup()

function renderHeader(props: Partial<ExperimentRecordHeaderProps> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ExperimentRecordHeader
            experiment={EXP}
            conditions={CONDITIONS}
            onRenamed={vi.fn()}
            onDeleted={vi.fn()}
            {...props}
          />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ExperimentRecordHeader', () => {
  it('embedded hides New Experiment, Create Replicates and Export, keeps Delete and background', () => {
    renderHeader({ embedded: true })
    expect(screen.queryByRole('button', { name: /new experiment/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create replicates/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export all/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark as background/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete experiment/i })).toBeInTheDocument()
  })

  it('shows the full action row when not embedded', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: /new experiment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create replicates/i })).toBeInTheDocument()
  })

  it('renders the ID at the requested heading level', () => {
    renderHeader({ headingLevel: 'h2' })
    expect(screen.getByRole('heading', { level: 2, name: 'HPHT_297-2' })).toBeInTheDocument()
  })

  it('links the reactor to its run by default', () => {
    renderHeader()
    expect(screen.getByRole('link', { name: /Reactor R09/ })).toHaveAttribute('href', '/hpht/HPHT_297')
  })

  it('reactorAsText prints the slot with no link', () => {
    renderHeader({ reactorAsText: true })
    expect(screen.getByText(/Reactor R09/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Reactor R09/ })).not.toBeInTheDocument()
  })

  it('calls onRenamed with the server response after a rename', async () => {
    const onRenamed = vi.fn()
    vi.mocked(experimentsApi.patch).mockResolvedValue({ ...EXP, experiment_id: 'HPHT_297-3' })
    renderHeader({ onRenamed })
    await user.click(screen.getByRole('button', { name: /rename experiment/i }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'HPHT_297-3{Enter}')
    await waitFor(() =>
      expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ experiment_id: 'HPHT_297-3' })),
    )
  })
})
