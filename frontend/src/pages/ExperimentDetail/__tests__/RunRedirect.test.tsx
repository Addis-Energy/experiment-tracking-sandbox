// Run segments live on their run page; /experiments/:id forwards them there.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'

vi.mock('@/api/experiments', () => ({
  experimentsApi: {
    get: vi.fn(),
    getReplicateGroup: vi.fn(),
    getGroup: vi.fn(),
    getResults: vi.fn(),
    getRollup: vi.fn(),
  },
}))
vi.mock('@/api/conditions', () => ({
  conditionsApi: { getByExperiment: vi.fn() },
}))
vi.mock('@/api/hpht', () => ({ hphtApi: { get: vi.fn() } }))
vi.mock('@/api/coreFloods', () => ({ coreFloodsApi: { get: vi.fn() } }))

import { ExperimentDetailPage } from '../index'
import { experimentsApi } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import { hphtApi } from '@/api/hpht'
import { coreFloodsApi } from '@/api/coreFloods'
import type { ExperimentDetail } from '@/api/experiments'
import type { RunSegment } from '@/api/runs'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
})

const BASE_DETAIL: ExperimentDetail = {
  id: 5, experiment_id: 'X', experiment_number: 150, status: 'ONGOING',
  researcher: null, date: null, sample_id: null, base_experiment_id: null,
  parent_experiment_fk: null, replicate_label: null, is_outlier: false,
  id_timepoint_days: null, created_at: '2026-07-01T00:00:00Z', updated_at: null,
  conditions: null, notes: [], modifications: [],
}

function mockExperiment(over: Partial<ExperimentDetail>, conditions: { experiment_type: string }) {
  vi.mocked(experimentsApi.get).mockResolvedValue({ ...BASE_DETAIL, ...over })
  vi.mocked(conditionsApi.getByExperiment).mockResolvedValue(conditions as never)
}

function runWith(ids: string[]) {
  const segments: RunSegment[] = ids.map((experiment_id, i) => ({
    id: i + 1, experiment_id, status: 'COMPLETED', date: null,
    parent_experiment_id: null, is_variant: false, description: null,
    conditions_id: null, pore_volume_mL: null, rock_mass_g: null, reactor_slot: null,
  }))
  return { base_id: ids[0], segments, conditions: null, samples: [], warnings: [] } as never
}

function Probe() {
  const location = useLocation()
  return <div data-testid="probe">{location.pathname + location.search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Routes>
            <Route path="/experiments/:id" element={<ExperimentDetailPage />} />
            <Route path="/hpht/:baseId" element={<Probe />} />
            <Route path="/core-floods/:baseId" element={<Probe />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  queryClient.clear()
  vi.clearAllMocks()
  vi.mocked(experimentsApi.getReplicateGroup).mockRejectedValue(new Error('404'))
  vi.mocked(experimentsApi.getGroup).mockRejectedValue(new Error('404'))
  vi.mocked(experimentsApi.getResults).mockResolvedValue([])
})

describe('detail page run redirect', () => {
  it('redirects an HPHT segment to its run, keeping the tab', async () => {
    mockExperiment({ experiment_id: 'HPHT_297-2', base_experiment_id: 'HPHT_297' }, { experiment_type: 'HPHT' })
    vi.mocked(hphtApi.get).mockResolvedValue(runWith(['HPHT_297', 'HPHT_297-2']))
    renderAt('/experiments/HPHT_297-2?tab=notes')
    expect(await screen.findByTestId('probe')).toHaveTextContent('/hpht/HPHT_297?segment=HPHT_297-2&tab=notes')
  })

  it('redirects a single-segment core flood', async () => {
    mockExperiment({ experiment_id: 'CF_031', base_experiment_id: 'CF_031' }, { experiment_type: 'Core Flood' })
    vi.mocked(coreFloodsApi.get).mockResolvedValue(runWith(['CF_031']))
    renderAt('/experiments/CF_031')
    expect(await screen.findByTestId('probe')).toHaveTextContent('/core-floods/CF_031?segment=CF_031')
  })

  it('renders the detail page when the run cannot be loaded', async () => {
    mockExperiment({ experiment_id: 'HPHT_X', base_experiment_id: 'HPHT_X' }, { experiment_type: 'HPHT' })
    vi.mocked(hphtApi.get).mockRejectedValue(Object.assign(new Error('nf'), { response: { status: 404 } }))
    renderAt('/experiments/HPHT_X')
    expect(await screen.findByRole('heading', { level: 1, name: 'HPHT_X' })).toBeInTheDocument()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })

  it('renders the detail page when the run does not contain the experiment', async () => {
    mockExperiment({ experiment_id: 'HPHT_Y', base_experiment_id: 'HPHT_297' }, { experiment_type: 'HPHT' })
    vi.mocked(hphtApi.get).mockResolvedValue(runWith(['HPHT_297']))
    renderAt('/experiments/HPHT_Y')
    expect(await screen.findByRole('heading', { level: 1, name: 'HPHT_Y' })).toBeInTheDocument()
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument()
  })

  it('does not query a run or redirect for a serum experiment', async () => {
    mockExperiment({ experiment_id: 'SERUM_001a', base_experiment_id: 'SERUM_001' }, { experiment_type: 'Serum' })
    renderAt('/experiments/SERUM_001a')
    expect(await screen.findByRole('heading', { level: 1, name: 'SERUM_001a' })).toBeInTheDocument()
    expect(hphtApi.get).not.toHaveBeenCalled()
    expect(coreFloodsApi.get).not.toHaveBeenCalled()
  })
})
