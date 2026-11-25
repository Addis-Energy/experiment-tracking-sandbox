import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ExperimentDetail } from '@/api/experiments'
import type { ConditionsResponse } from '@/api/conditions'
import type { CoreFloodRun, CoreFloodSample, CoreFloodSegment } from '@/api/coreFloods'
import { ToastProvider } from '@/components/ui'

vi.mock('@/api/coreFloods', () => ({
  coreFloodsApi: { get: vi.fn(), icp: vi.fn(), createSample: vi.fn(), updateSample: vi.fn() },
}))

vi.mock('@/api/experiments', () => ({
  experimentsApi: {
    patchStatus: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
    checkExists: vi.fn(),
    patchNote: vi.fn(),
    addNote: vi.fn(),
    exportAll: vi.fn(),
    getDeleteImpact: vi.fn(),
    delete: vi.fn(),
    getResults: vi.fn(),
  },
}))
vi.mock('@/api/conditions', () => ({ conditionsApi: { patch: vi.fn(), getByExperiment: vi.fn() } }))

import { coreFloodsApi } from '@/api/coreFloods'
import { experimentsApi } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import { CoreFloodRunPage } from '../CoreFloodRunPage'

const segment = (over: Partial<CoreFloodSegment>): CoreFloodSegment => ({
  id: 1,
  experiment_id: 'CF_020',
  status: 'COMPLETED',
  date: '2026-10-23T00:00:00',
  parent_experiment_id: null,
  is_variant: false,
  description: 'First segment',
  conditions_id: 1,
  pore_volume_mL: 12.5,
  rock_mass_g: 100,
  reactor_slot: 'CF01',
  ...over,
})

const sample = (over: Partial<CoreFloodSample>): CoreFloodSample => ({
  result_id: 1,
  experiment_id: 'CF_020',
  experiment_fk: 1,
  run_base_id: 'CF_020',
  is_variant: false,
  time_post_reaction_days: 1,
  cumulative_time_post_reaction_days: 1,
  sample_date: '2026-10-24T00:00:00',
  gc_run_date: null,
  sample_tube_number: 7,
  flow_rate_mL_min: 0.5,
  nitrogen_flow_rate_mL_min: null,
  inlet_pressure_psi: null,
  outlet_pressure_psi: null,
  sampling_volume_mL: 3.25,
  h2_concentration: 100,
  gas_sampling_volume_ml: null,
  gas_sampling_pressure_MPa: null,
  h2_micromoles: 1.5,
  h2_mass_ug: null,
  h2_grams_per_ton_yield: 2.5,
  final_ph: 7.1,
  final_conductivity_mS_cm: 4.2,
  pore_volume_mL: 12.5,
  interval_days: 1,
  cumulative_liquid_volume_mL: 3.25,
  cumulative_pore_volumes: 0.26,
  cumulative_h2_grams_per_ton: 2.5,
  h2_grams_per_ton_per_day: 2.5,
  is_hold_interval: false,
  permeability_flow_rate_mL_min: null,
  notes: [],
  ...over,
})

const RUN: CoreFloodRun = {
  base_id: 'CF_020',
  warnings: [],
  segments: [
    segment({}),
    segment({
      id: 2,
      experiment_id: 'CF_020-2',
      status: 'ONGOING',
      parent_experiment_id: 'CF_020',
      reactor_slot: 'CF02',
      date: '2026-10-30T00:00:00',
      pore_volume_mL: null,
      description: null,
    }),
    segment({
      id: 3,
      experiment_id: 'CF_020-5_Bypass1',
      status: 'COMPLETED',
      parent_experiment_id: 'CF_020-2',
      is_variant: true,
      reactor_slot: null,
    }),
  ],
  samples: [
    // legacy row: no cumulative time, no liquid volume
    sample({
      result_id: 10,
      cumulative_time_post_reaction_days: null,
      sampling_volume_mL: null,
      sample_tube_number: 11,
      cumulative_pore_volumes: null,
    }),
    sample({
      result_id: 11,
      experiment_id: 'CF_020-2',
      sample_tube_number: 12,
      flow_rate_mL_min: 0,
      cumulative_time_post_reaction_days: 5,
      cumulative_h2_grams_per_ton: 42.12349,
      cumulative_pore_volumes: 1.23456,
    }),
    sample({
      result_id: 12,
      experiment_id: 'CF_020-5_Bypass1',
      is_variant: true,
      sample_tube_number: 13,
      cumulative_h2_grams_per_ton: null,
      cumulative_pore_volumes: null,
      h2_grams_per_ton_per_day: null,
    }),
  ],
}

function Probe() {
  const { pathname, search } = useLocation()
  return (
    <>
      <div data-testid="path">{pathname}</div>
      <div data-testid="location">{pathname + search}</div>
      <div data-testid="nav-type">{useNavigationType()}</div>
    </>
  )
}

const currentLocation = () => screen.getByTestId('location').textContent ?? ''

const detailOf = (id: string): ExperimentDetail => ({
  id: 2,
  experiment_id: id,
  experiment_number: 20,
  status: 'ONGOING',
  researcher: null,
  date: '2026-10-30T00:00:00',
  sample_id: null,
  base_experiment_id: 'CF_020',
  parent_experiment_fk: 1,
  replicate_label: null,
  is_outlier: false,
  id_timepoint_days: null,
  created_at: '2026-10-30T00:00:00Z',
  updated_at: null,
  conditions: null,
  notes: id === 'CF_020-2'
    ? [{
        id: 1, experiment_id: id, note_type: 'observation', note_text: 'note 1', result_id: null,
        created_by: null, needs_review: false, created_at: '2026-10-31T00:00:00Z', updated_at: null,
      }]
    : [],
  modifications: [],
})

const conditionsOf = (id: string): ConditionsResponse => ({
  id: 1, experiment_fk: 1, experiment_id: id, experiment_type: 'Core Flood', reactor_number: 2,
  reactor_slot: 'CF02', created_at: '2026-10-30T00:00:00',
})

/** The selected segment's record header and tabs read these two. */
function mockSegmentQueries() {
  vi.mocked(experimentsApi.get).mockReset()
  vi.mocked(experimentsApi.get).mockImplementation(async (id: string) => detailOf(id))
  vi.mocked(conditionsApi.getByExperiment).mockImplementation(async (id: string) => conditionsOf(id))
  vi.mocked(experimentsApi.getResults).mockResolvedValue([])
}

function renderPage(path = '/core-floods/CF_020') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <Routes>
            <Route path="/core-floods/:baseId" element={<CoreFloodRunPage />} />
          </Routes>
          <Probe />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('CoreFloodRunPage', () => {
  beforeEach(() => {
    mockSegmentQueries()
    vi.mocked(coreFloodsApi.get).mockReset()
    vi.mocked(coreFloodsApi.get).mockResolvedValue(RUN)
    vi.mocked(coreFloodsApi.icp).mockReset()
    vi.mocked(coreFloodsApi.icp).mockResolvedValue([])
  })

  it('Export all sends the root segment ID', async () => {
    vi.mocked(experimentsApi.exportAll).mockResolvedValue('CF_020_export_2026-11-06.xlsx')
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Export all' }))
    expect(experimentsApi.exportAll).toHaveBeenCalledWith('CF_020')
    expect(await screen.findByText('Export downloaded')).toBeInTheDocument()
  })

  it('side samples open by default, and collapse', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: /^Side samples/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const region = screen.getByRole('region', { name: 'Side samples' })
    expect(within(region).getByText('CF_020-5_Bypass1')).toBeInTheDocument()
    // the variant is not in the main samples table
    const main = screen.getByRole('region', { name: 'Samples' })
    expect(within(main).queryByText('CF_020-5_Bypass1')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Side samples' })).not.toBeInTheDocument()
  })

  it('header shows run description, rig and ongoing segment', async () => {
    renderPage()
    // The Segments table (open for several segments) repeats it; the header is the <p>.
    expect(await screen.findByText('First segment', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Rig CF02')).toBeInTheDocument()
    // Issue #158: the ongoing segment is a link to its experiment page.
    const badge = screen.getByText(/^Ongoing:/)
    expect(badge).toHaveTextContent('Ongoing: CF_020-2')
    expect(within(badge).getByRole('link', { name: 'CF_020-2' })).toHaveAttribute('href', '/core-floods/CF_020?segment=CF_020-2')
  })

  it('samples table comes before the other sections; every section is open', async () => {
    renderPage()
    const main = await screen.findByRole('region', { name: 'Samples' })
    const seg = screen.getByRole('button', { name: /^Segments/ })
    expect(main.compareDocumentPosition(seg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const name of [/^Segments/, /^Side samples/, /^Run totals/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
    }
    expect(screen.queryByRole('button', { name: /^Data checks/ })).not.toBeInTheDocument()
  })

  it('run totals open by default and show cumulative H₂', async () => {
    renderPage()
    const toggle = await screen.findByRole('button', { name: /^Run totals/ })
    expect(toggle).toHaveTextContent('Cum. H₂ 42.1 g/t · Pore volumes 1.2')
    const label = screen.getByText('Cumulative H₂ to date')
    expect(label.parentElement).toHaveTextContent('42.1')
    expect(screen.getByText('Pore volumes to date').parentElement).toHaveTextContent('1.2')
  })

  it('segments summary links every segment; rename from data checks reopens a closed table', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings([{ code: 'multiple_roots', experiment_ids: ['CF_020', 'CF_020-2'] }]),
    )
    renderPage()
    const seg = await screen.findByRole('button', { name: /^Segments/ })
    expect(seg).toHaveTextContent('3')
    const header = seg.parentElement!
    expect(header).toHaveTextContent('3(CF_020, CF_020-2, CF_020-5_Bypass1)')
    const summaryLinks = within(header).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(summaryLinks).toEqual([
      '/core-floods/CF_020?segment=CF_020', '/core-floods/CF_020?segment=CF_020-2',
      '/core-floods/CF_020?segment=CF_020-5_Bypass1',
    ])
    // A summary link is outside the toggle: following it does not collapse the table.
    expect(within(seg).queryByRole('link')).toBeNull()

    await userEvent.click(seg)
    expect(seg).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Rename CF_020-2' }))
    expect(seg).toHaveAttribute('aria-expanded', 'true')
  })

  it('a single-segment run has no Segments section', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(withWarnings([], [segment({})]))
    renderPage()
    await screen.findByRole('region', { name: 'Samples' })
    expect(screen.queryByRole('button', { name: /^Segments/ })).not.toBeInTheDocument()
  })

  it('a segment ID in the URL is replaced by the run base ID', async () => {
    renderPage('/core-floods/CF_020-2')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/core-floods\/CF_020$/))
    expect(screen.getByTestId('nav-type')).toHaveTextContent('REPLACE')
    expect(await screen.findByRole('heading', { name: 'CF_020', level: 1 })).toBeInTheDocument()
  })

  it('side-sample IDs link to their experiment without opening the editor', async () => {
    renderPage()
    await openSection(/^Side samples/)
    const side = await screen.findByRole('region', { name: 'Side samples' })
    const link = within(side).getByRole('link', { name: 'CF_020-5_Bypass1' })
    expect(link).toHaveAttribute('href', '/core-floods/CF_020?segment=CF_020-5_Bypass1')
    await userEvent.click(link)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('deletes a segment in place after the typed-ID check', async () => {
    vi.mocked(experimentsApi.getDeleteImpact).mockResolvedValue({
      experiment_id: 'CF_020-2', conditions: 1, results: 1, scalar_results: 1, icp_results: 0,
      result_files: 0, notes: 0, additives: 0, external_analyses: 0, xrd_phases: 0, total: 3,
      background_for: [], h2_background_for: [], replicate_children: [],
    })
    vi.mocked(experimentsApi.delete).mockResolvedValue({ experiment_id: 'CF_020-2' } as never)
    renderPage()
    const before = vi.mocked(coreFloodsApi.get).mock.calls.length
    await openSection(/^Segments/)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete CF_020-2' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = await within(dialog).findByRole('button', { name: /^Delete/ })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByPlaceholderText('CF_020-2'), 'CF_020-2')
    await userEvent.click(confirm)
    await waitFor(() => expect(experimentsApi.delete).toHaveBeenCalledWith('CF_020-2'))
    await waitFor(() => expect(vi.mocked(coreFloodsApi.get).mock.calls.length).toBeGreaterThan(before))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/core-floods\/CF_020$/)
  })

  it('segments table has no pore volume column', async () => {
    renderPage()
    await openSection(/^Segments/)
    const region = screen.getByRole('region', { name: 'Segments' })
    const headers = within(region).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Segment', 'Status', 'Description'])
    expect(within(region).queryByLabelText(/pore volume/i)).not.toBeInTheDocument()
  })

  it('an ICP failure does not break the page', async () => {
    vi.mocked(coreFloodsApi.icp).mockRejectedValue(new Error('icp down'))
    renderPage()
    expect(await screen.findByRole('region', { name: 'Samples' })).toBeInTheDocument()
  })

  it('ICP fetch failure keeps the page and shows no expander', async () => {
    const rejected = new Error('icp down')
    const failing = Promise.reject(rejected)
    failing.catch(() => {})
    vi.mocked(coreFloodsApi.icp).mockReturnValue(failing)
    renderPage()
    expect(await screen.findByRole('region', { name: 'Samples' })).toBeInTheDocument()
    await waitFor(() => expect(coreFloodsApi.icp).toHaveBeenCalled())
    await expect(failing).rejects.toBe(rejected)
    expect(screen.queryByRole('button', { name: /Show ICP for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ICP over time/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Samples' })).toBeInTheDocument()
  })

  it('empty root description falls back', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings([], [
        segment({ id: 1, description: '' }),
        segment({ id: 2, experiment_id: 'CF_020-2', parent_experiment_id: 'CF_020', description: 'Second segment' }),
      ]),
    )
    renderPage()
    expect(await screen.findByText('Second segment', { selector: 'p' })).toBeInTheDocument()
  })

  it('editing a description from Data checks on a multi-segment run opens Segments', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings([{ code: 'missing_description', experiment_ids: ['CF_020-2'] }]),
    )
    renderPage()
    const seg = await screen.findByRole('button', { name: /^Segments/ })
    await userEvent.click(seg)
    expect(seg).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Describe CF_020-2' }))
    expect(seg).toHaveAttribute('aria-expanded', 'true')
  })

  it('ICP rows get an expander in the samples table', async () => {
    vi.mocked(coreFloodsApi.icp).mockResolvedValue([
      {
        result_id: 11,
        experiment_id: 'CF_020-2',
        is_variant: false,
        cumulative_time_post_reaction_days: 5,
        sample_date: '2026-10-24T00:00:00',
        elements: { fe: 12.4 },
      },
    ])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Show ICP for/ }))
    expect(screen.getByText('Fe 12.4')).toBeInTheDocument()
  })

  it('shows ICP over time only when the run has ICP', async () => {
    vi.mocked(coreFloodsApi.icp).mockResolvedValue([
      {
        result_id: 11,
        experiment_id: 'CF_020-2',
        is_variant: false,
        cumulative_time_post_reaction_days: 5,
        sample_date: '2026-10-24T00:00:00',
        elements: { fe: 12.4 },
      },
    ])
    const { unmount } = renderPage()
    const btn = await screen.findByRole('button', { name: /^ICP over time/ })
    // Issue #161 (NAV-14): the count in the summary; open by default, as on the HPHT run page.
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(btn).toHaveTextContent(/1 sample$/)
    unmount()
    vi.mocked(coreFloodsApi.icp).mockResolvedValue([])
    renderPage()
    await screen.findByRole('region', { name: 'Samples' })
    expect(screen.queryByRole('button', { name: /^ICP over time/ })).not.toBeInTheDocument()
  })

  it('a zero flow shows a HOLD badge', async () => {
    renderPage()
    const main = await screen.findByRole('region', { name: 'Samples' })
    expect(within(main).getAllByText('HOLD')).toHaveLength(1)
  })

  it('legacy nulls render as dashes, newest first', async () => {
    renderPage()
    const main = await screen.findByRole('region', { name: 'Samples' })
    const rows = within(main).getAllByRole('row').slice(2)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('12')).toBeInTheDocument()
    expect(within(rows[1]).getByText('11')).toBeInTheDocument()
    const cells = within(rows[1]).getAllByRole('cell')
    // Segment, Date, Day lead the row (no expander since #164).
    expect(cells[2]).toHaveTextContent('—') // Day
    // Issue #163: Cum. H₂ g/t and g/t/day now sit in the GC group, so Liq mL moved.
    expect(cells[12]).toHaveTextContent('—') // Liq mL
  })

  it("the rig is the latest-dated segment's slot, as in the run list", async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings(
        [],
        [
          segment({ id: 1, experiment_id: 'CF_020', date: '2026-10-30T00:00:00', reactor_slot: 'CF01' }),
          segment({ id: 2, experiment_id: 'CF_020-2', date: '2026-10-23T00:00:00', reactor_slot: 'CF02' }),
        ],
      ),
    )
    renderPage()
    expect(await screen.findByText('Rig CF01')).toBeInTheDocument()
  })

  it('shows not-found for a 404', async () => {
    vi.mocked(coreFloodsApi.get).mockRejectedValue(
      Object.assign(new Error('nope'), { response: { status: 404 } }),
    )
    renderPage('/core-floods/CF_999')
    expect(await screen.findByText('No core flood run CF_999')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /core floods/i })).toHaveAttribute('href', '/core-floods')
    expect(screen.getByRole('link', { name: 'Open experiment CF_999' })).toHaveAttribute(
      'href', '/experiments/CF_999',
    )
  })

  it('opens the modal from Add sample and from a row click', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '+ Add sample' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('a run with segments but no samples shows the empty state, blank totals, and Add sample works (#139)', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue({ ...RUN, samples: [] })
    renderPage()
    const main = await screen.findByRole('region', { name: 'Samples' })
    expect(within(main).getByText('No samples yet')).toBeInTheDocument()

    const totals = screen.getByRole('button', { name: /^Run totals/ })
    expect(totals).toHaveTextContent('Cum. H₂ — g/t · Pore volumes —')
    expect(screen.getByText('Cumulative H₂ to date').parentElement).not.toHaveTextContent(/\d/)
    expect(screen.getByText('Pore volumes to date').parentElement).not.toHaveTextContent(/\d/)

    await userEvent.click(screen.getByRole('button', { name: '+ Add sample' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('a non-variant sample row opens the modal in edit mode', async () => {
    renderPage()
    const main = await screen.findByRole('region', { name: 'Samples' })
    await userEvent.click(within(main).getAllByRole('row')[2])
    expect(await screen.findByRole('dialog', { name: 'Edit sample — CF_020-2' })).toBeInTheDocument()
  })
})

const openSection = (name: RegExp) =>
  screen.findByRole('button', { name }).then(async (b) => {
    if (b.getAttribute('aria-expanded') !== 'true') await userEvent.click(b)
  })

const withWarnings = (warnings: CoreFloodRun['warnings'], segments?: CoreFloodSegment[]): CoreFloodRun => ({
  ...RUN,
  warnings,
  segments: segments ?? RUN.segments,
})

describe('CoreFloodRunPage segment edits and cleanup', () => {
  beforeEach(() => {
    mockSegmentQueries()
    vi.mocked(coreFloodsApi.get).mockReset()
    vi.mocked(coreFloodsApi.get).mockResolvedValue(RUN)
    vi.mocked(coreFloodsApi.icp).mockReset()
    vi.mocked(coreFloodsApi.icp).mockResolvedValue([])
    vi.mocked(experimentsApi.patchStatus).mockReset()
    vi.mocked(experimentsApi.patch).mockReset()
    vi.mocked(experimentsApi.checkExists).mockReset()
    vi.mocked(experimentsApi.checkExists).mockResolvedValue({ exists: false })
    vi.mocked(conditionsApi.patch).mockReset()
  })

  it('a multiple_ongoing warning shows the status action', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings([{ code: 'multiple_ongoing', experiment_ids: ['CF_020', 'CF_020-2'] }]),
    )
    vi.mocked(experimentsApi.patchStatus).mockResolvedValue({} as never)
    renderPage()
    await openSection(/^Data checks/)
    const card = (await screen.findByRole('heading', { name: 'Cleanup' })).closest('section')!
    expect(within(card).getAllByRole('combobox')).toHaveLength(2)
    for (const id of ['CF_020', 'CF_020-2']) {
      const label = within(card).getByText(id, { selector: 'span' })
      expect(within(label.parentElement!).getByRole('combobox', { name: `Status of ${id}` })).toBeInTheDocument()
    }
    await userEvent.selectOptions(
      within(card).getByRole('combobox', { name: 'Status of CF_020-2' }),
      'COMPLETED',
    )
    expect(experimentsApi.patchStatus).toHaveBeenCalledWith('CF_020-2', 'COMPLETED')
  })

  it('set pore volume for all segments patches each missing segment', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings(
        [{ code: 'missing_pore_volume', experiment_ids: ['CF_020', 'CF_020-2'] }],
        [segment({ id: 1, conditions_id: 11 }), segment({ id: 2, experiment_id: 'CF_020-2', conditions_id: 12 })],
      ),
    )
    vi.mocked(conditionsApi.patch).mockResolvedValue({} as never)
    renderPage()
    await openSection(/^Data checks/)
    await userEvent.type(await screen.findByLabelText('Pore volume for all segments'), '42')
    await userEvent.click(screen.getByRole('button', { name: 'Set pore volume for all segments' }))
    await waitFor(() => expect(conditionsApi.patch).toHaveBeenCalledTimes(2))
    expect(conditionsApi.patch).toHaveBeenCalledWith(11, { pore_volume_mL: 42 })
    expect(conditionsApi.patch).toHaveBeenCalledWith(12, { pore_volume_mL: 42 })
  })

  it('renaming the only segment moves the URL to the new run', async () => {
    const lone = withWarnings([], [segment({ id: 9, experiment_id: 'CF_020_5_Brine' })])
    vi.mocked(coreFloodsApi.get).mockImplementation(async (id) =>
      id === 'CF_020' ? RUN : { ...lone, base_id: id },
    )
    vi.mocked(experimentsApi.patch).mockResolvedValue({
      experiment_id: 'CF_020-5_Brine',
      base_experiment_id: 'CF_020',
    } as never)
    renderPage('/core-floods/CF_020_5')
    await waitFor(() => expect(document.getElementById('record-header')).not.toBeNull())
    await renameTo('CF_020-5_Brine')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/core-floods/CF_020'))
    expect(experimentsApi.patch).toHaveBeenCalledWith('CF_020_5_Brine', { experiment_id: 'CF_020-5_Brine' })
    await waitFor(() => expect(coreFloodsApi.get).toHaveBeenLastCalledWith('CF_020'))
    // the old run no longer exists: it must be dropped, not refetched into a 404
    const afterSave = vi.mocked(coreFloodsApi.get).mock.calls.filter(([id]) => id === 'CF_020_5')
    expect(afterSave).toHaveLength(1)
  })

  it('renaming one of several segments refetches the run in place', async () => {
    const renamed: CoreFloodRun = {
      ...RUN,
      segments: RUN.segments.map((s) => (s.id === 2 ? { ...s, experiment_id: 'CF_020-3' } : s)),
    }
    vi.mocked(experimentsApi.patch).mockImplementation(async () => {
      vi.mocked(coreFloodsApi.get).mockResolvedValue(renamed)
      return { experiment_id: 'CF_020-3', base_experiment_id: 'CF_020' } as never
    })
    renderPage()
    await openSection(/^Segments/)
    await userEvent.click(await screen.findByRole('button', { name: 'Rename CF_020-2' }))
    const input = screen.getByLabelText('New experiment ID')
    await userEvent.clear(input)
    await userEvent.type(input, 'CF_020-3')
    const save = screen.getByRole('button', { name: 'Save' })
    await waitFor(() => expect(save).toBeEnabled())
    await userEvent.click(save)
    const seg = await screen.findByRole('region', { name: 'Segments' })
    await waitFor(() => expect(within(seg).getByText('CF_020-3', { selector: 'td *, td' })).toBeInTheDocument())
    expect(coreFloodsApi.get).toHaveBeenLastCalledWith('CF_020')
    expect(screen.getByTestId('path')).toHaveTextContent('/core-floods/CF_020')
  })

  it('a rejected status change shows the server detail', async () => {
    vi.mocked(experimentsApi.patchStatus).mockRejectedValue(new Error('Reactor CF01 is occupied by CF_026'))
    renderPage()
    await openSection(/^Segments/)
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Status of CF_020' }), 'ONGOING')
    expect(await screen.findByText('Reactor CF01 is occupied by CF_026')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status of CF_020' })).toHaveValue('COMPLETED')
  })

  it('a partial pore volume failure still refreshes and names the failed segment', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings(
        [{ code: 'missing_pore_volume', experiment_ids: ['CF_020', 'CF_020-2'] }],
        [segment({ id: 1, conditions_id: 11 }), segment({ id: 2, experiment_id: 'CF_020-2', conditions_id: 12 })],
      ),
    )
    vi.mocked(conditionsApi.patch).mockImplementation(async (id) => {
      if (id === 12) throw new Error('boom')
      return {} as never
    })
    renderPage()
    await openSection(/^Data checks/)
    await userEvent.type(await screen.findByLabelText('Pore volume for all segments'), '42')
    const before = vi.mocked(coreFloodsApi.get).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Set pore volume for all segments' }))
    expect(await screen.findByText(/CF_020-2 \(boom\)/)).toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(coreFloodsApi.get).mock.calls.length).toBeGreaterThan(before))
  })

  it('cleanup buttons name their segment', async () => {
    vi.mocked(coreFloodsApi.get).mockResolvedValue(
      withWarnings([
        { code: 'multiple_roots', experiment_ids: ['CF_020', 'CF_020-2'] },
        { code: 'sample_missing_flow_rate', experiment_ids: ['CF_020'] },
      ], [segment({}), segment({ id: 2, experiment_id: 'CF_020-2' })]),
    )
    vi.mocked(coreFloodsApi.get).mockResolvedValue({
      ...(await coreFloodsApi.get('x')),
      samples: [sample({ result_id: 50, flow_rate_mL_min: null })],
    })
    renderPage()
    await openSection(/^Data checks/)
    const card = (await screen.findByRole('heading', { name: 'Cleanup' })).closest('section')!
    expect(within(card).getByRole('button', { name: 'Rename CF_020-2' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /^Edit CF_020 · / })).toBeInTheDocument()
  })

  it('Describe then Cancel returns the cell to the description button', async () => {
    renderPage()
    await openSection(/^Segments/)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit description of CF_020' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: 'Edit description of CF_020' })).toBeInTheDocument()
    expect(screen.queryByTestId('description-editor')).not.toBeInTheDocument()
  })

  it('a failed description fetch shows the error and a way back', async () => {
    vi.mocked(experimentsApi.get).mockRejectedValue(new Error('nope'))
    renderPage()
    await openSection(/^Segments/)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit description of CF_020' }))
    expect(await screen.findByText(/Could not load description: nope/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Edit description of CF_020' })).toBeInTheDocument()
  })
})

const ONE_SEGMENT: CoreFloodRun = withWarnings([], [RUN.segments[0]])

/** Mounts the page at `path` and waits for the selected segment's record header. */
async function renderRun(path: string, run: CoreFloodRun = RUN) {
  vi.mocked(coreFloodsApi.get).mockImplementation(async () => run)
  vi.mocked(coreFloodsApi.icp).mockResolvedValue([
    { result_id: 11, experiment_id: 'CF_020-2', is_variant: false, sample_date: null,
      cumulative_time_post_reaction_days: 5, elements: { fe: 12.4 } },
  ])
  renderPage(path)
  await waitFor(() => expect(document.getElementById('record-header')).not.toBeNull())
}

async function deleteViaModal(id: string) {
  vi.mocked(experimentsApi.getDeleteImpact).mockResolvedValue({
    experiment_id: id, conditions: 1, results: 0, scalar_results: 0, icp_results: 0, result_files: 0,
    notes: 0, additives: 0, external_analyses: 0, xrd_phases: 0, total: 1,
    background_for: [], h2_background_for: [], replicate_children: [],
  })
  vi.mocked(experimentsApi.delete).mockResolvedValue({} as never)
  await userEvent.click(screen.getByRole('button', { name: /delete experiment/i }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.type(await within(dialog).findByLabelText(/type the experiment id/i), id)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
}

async function renameTo(newId: string) {
  vi.mocked(experimentsApi.checkExists).mockResolvedValue({ exists: false })
  await userEvent.click(screen.getByRole('button', { name: /rename experiment/i }))
  const input = screen.getByRole('textbox')
  await userEvent.clear(input)
  await userEvent.type(input, newId)
  const save = screen.getByRole('button', { name: 'Save' })
  await waitFor(() => expect(save).toBeEnabled())
  await userEvent.click(save)
}

const MAIN_SAMPLE_COUNT = 2
const SEGMENT_2_SAMPLE_COUNT = 1

describe('one page per run', () => {
  beforeEach(() => {
    vi.mocked(coreFloodsApi.get).mockReset()
    vi.mocked(coreFloodsApi.icp).mockReset()
    mockSegmentQueries()
    vi.mocked(experimentsApi.patch).mockReset()
  })

  it('single-segment run: no picker, no Segments section, record header at h1', async () => {
    await renderRun('/core-floods/CF_020', ONE_SEGMENT)
    expect(screen.queryByRole('navigation', { name: 'Segments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /segments/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'CF_020' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rename experiment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete experiment/i })).toBeInTheDocument()
  })

  it('multi-segment run: picker, run heading at h1, selected segment header at h2', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    expect(screen.getByRole('navigation', { name: 'Segments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'CF_020' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'CF_020-2' })).toBeInTheDocument()
  })

  it('marks the selected segment rows and shows the whole run', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    // Side samples are open too, so count the main table only.
    const rows = within(screen.getByRole('region', { name: 'Samples' })).getAllByTestId(/^sample-/)
    expect(rows.length).toBe(MAIN_SAMPLE_COUNT)
    expect(rows.filter((r) => r.dataset.marked === 'true').length).toBe(SEGMENT_2_SAMPLE_COUNT)
  })

  it('only=1 narrows the table to the segment', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2&only=1')
    expect(
      within(screen.getByRole('region', { name: 'Samples' })).getAllByTestId(/^sample-/).length,
    ).toBe(SEGMENT_2_SAMPLE_COUNT)
  })

  it('the notes tab shows the selected segment notes, not the samples', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2&tab=notes')
    await waitFor(() => expect(experimentsApi.get).toHaveBeenCalledWith('CF_020-2'))
    expect(screen.queryByRole('heading', { name: 'Samples' })).not.toBeInTheDocument()
    expect(await screen.findByText('note 1')).toBeInTheDocument()
  })

  it('shows H₂ over time with no Fe²⁺ yield chart', async () => {
    await renderRun('/core-floods/CF_020')
    expect(screen.getByRole('heading', { name: /H₂ over time/i })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Cumulative H₂' })).toBeInTheDocument()
    expect(screen.queryByRole('figure', { name: /Fe²⁺/ })).not.toBeInTheDocument()
  })

  it('opens ICP over time by default', async () => {
    await renderRun('/core-floods/CF_020')
    expect(await screen.findByRole('button', { name: /ICP over time/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('orders Results as Samples, H₂ over time, ICP over time, Side samples, Segments', async () => {
    await renderRun('/core-floods/CF_020')
    const icp = await screen.findByRole('button', { name: /ICP over time/i })
    const order = [
      screen.getByRole('heading', { name: 'Samples' }),
      screen.getByRole('heading', { name: /H₂ over time/i }),
      icp,
      screen.getByRole('button', { name: /^Side samples/ }),
      screen.getByRole('button', { name: /^Segments/ }),
    ]
    order.slice(1).forEach((el, i) =>
      expect(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy())
  })

  it('a segment ID in the path keeps the query and selects that segment', async () => {
    await renderRun('/core-floods/CF_020-2?tab=notes')
    await waitFor(() => expect(currentLocation()).toBe('/core-floods/CF_020?segment=CF_020-2&tab=notes'))
  })

  it('deleting the selected segment of a multi-segment run stays on the run', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    await deleteViaModal('CF_020-2')
    await waitFor(() => expect(currentLocation()).toBe('/core-floods/CF_020'))
  })

  it('never points at the deleted segment while the run refetches', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    // Hold the post-delete run back, so the page lives on the cached run.
    vi.mocked(coreFloodsApi.get).mockImplementation(() => new Promise<CoreFloodRun>(() => {}))
    vi.mocked(experimentsApi.get).mockClear()
    await deleteViaModal('CF_020-2')
    await waitFor(() => expect(currentLocation()).toBe('/core-floods/CF_020'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 20)) // the header's deferred cache eviction

    expect(screen.queryByRole('link', { name: 'CF_020-2' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('sample-11')).not.toBeInTheDocument()
    expect(experimentsApi.get).not.toHaveBeenCalledWith('CF_020-2')
  })

  it('deleting the only segment goes to the core flood list', async () => {
    await renderRun('/core-floods/CF_020', ONE_SEGMENT)
    await deleteViaModal('CF_020')
    await waitFor(() => expect(currentLocation()).toBe('/core-floods'))
  })

  it('renaming the selected segment follows it to its new home', async () => {
    vi.mocked(experimentsApi.patch).mockResolvedValue({
      ...detailOf('CF_020-2'), experiment_id: 'CF_020-3', base_experiment_id: 'CF_020',
    })
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    await renameTo('CF_020-3')
    await waitFor(() => expect(currentLocation()).toBe('/core-floods/CF_020?segment=CF_020-3'))
  })

  it('F4: deleting the selected segment from the Segments table never points at it', async () => {
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    vi.mocked(experimentsApi.getDeleteImpact).mockResolvedValue({
      experiment_id: 'CF_020-2', conditions: 1, results: 0, scalar_results: 0, icp_results: 0, result_files: 0,
      notes: 0, additives: 0, external_analyses: 0, xrd_phases: 0, total: 1,
      background_for: [], h2_background_for: [], replicate_children: [],
    })
    vi.mocked(experimentsApi.delete).mockResolvedValue({} as never)
    // Hold the post-delete run back, so the page lives on the cached run.
    vi.mocked(coreFloodsApi.get).mockImplementation(() => new Promise<CoreFloodRun>(() => {}))
    vi.mocked(experimentsApi.get).mockClear()
    const segments = screen.getByRole('region', { name: 'Segments' })
    await userEvent.click(within(segments).getByRole('button', { name: 'Delete CF_020-2' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(await within(dialog).findByPlaceholderText('CF_020-2'), 'CF_020-2')
    await userEvent.click(within(dialog).getByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(currentLocation()).toBe('/core-floods/CF_020'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 20))

    expect(screen.queryByRole('link', { name: 'CF_020-2' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('sample-11')).not.toBeInTheDocument()
    expect(experimentsApi.get).not.toHaveBeenCalledWith('CF_020-2')
  })

  it('F4: renaming the selected segment from the Segments table follows it in the URL', async () => {
    const renamed: CoreFloodRun = {
      ...RUN,
      segments: RUN.segments.map((s) => (s.id === 2 ? { ...s, experiment_id: 'CF_020-3' } : s)),
      samples: RUN.samples.map((s) => (s.experiment_id === 'CF_020-2' ? { ...s, experiment_id: 'CF_020-3' } : s)),
    }
    await renderRun('/core-floods/CF_020?segment=CF_020-2')
    vi.mocked(experimentsApi.checkExists).mockResolvedValue({ exists: false })
    vi.mocked(experimentsApi.patch).mockImplementation(async () => {
      vi.mocked(coreFloodsApi.get).mockImplementation(async () => renamed)
      return { ...detailOf('CF_020-3'), base_experiment_id: 'CF_020' }
    })
    const segments = screen.getByRole('region', { name: 'Segments' })
    await userEvent.click(within(segments).getByRole('button', { name: 'Rename CF_020-2' }))
    const input = screen.getByLabelText('New experiment ID')
    await userEvent.clear(input)
    await userEvent.type(input, 'CF_020-3')
    const save = screen.getByRole('button', { name: 'Save' })
    await waitFor(() => expect(save).toBeEnabled())
    vi.mocked(experimentsApi.get).mockClear()
    await userEvent.click(save)
    await waitFor(() => expect(currentLocation()).toBe('/core-floods/CF_020?segment=CF_020-3'))
    expect(await screen.findByRole('heading', { level: 2, name: 'CF_020-3' })).toBeInTheDocument()
    expect(experimentsApi.get).not.toHaveBeenCalledWith('CF_020-2')
  })

  it('F5: a Segments table ID selects the segment on this page', async () => {
    await renderRun('/core-floods/CF_020')
    const segments = screen.getByRole('region', { name: 'Segments' })
    const href = within(segments).getByRole('link', { name: 'CF_020-2' }).getAttribute('href') ?? ''
    expect(href).toContain('segment=CF_020-2')
    expect(href).not.toContain('/experiments/')
  })

  it('Data checks edits on a single-segment run scroll the record header into view', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      await renderRun(
        '/core-floods/CF_020',
        withWarnings([{ code: 'missing_description', experiment_ids: ['CF_020'] }], [segment({ description: null })]),
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Describe CF_020' }))
      expect(scroll).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /^Segments/ })).not.toBeInTheDocument()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
