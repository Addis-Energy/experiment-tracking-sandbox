import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { HphtRun } from '@/api/hpht'
import type { ConditionsResponse } from '@/api/conditions'
import type { ResultWithFlags } from '@/api/experiments'
import { ToastProvider } from '@/components/ui'
import { MAIN_SAMPLE_COUNT, RUN, SEG_2_DETAIL, SEGMENT_2_SAMPLE_COUNT, SINGLE_RUN, segment } from './fixtures'

vi.mock('@/api/hpht', () => ({ hphtApi: { list: vi.fn(), get: vi.fn(), icp: vi.fn() } }))
vi.mock('@/api/experiments', () => ({
  experimentsApi: {
    getResults: vi.fn(),
    createResult: vi.fn(),
    updateResult: vi.fn(),
    patchStatus: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
    checkExists: vi.fn(),
    patchNote: vi.fn(),
    addNote: vi.fn(),
    exportAll: vi.fn(),
    getDeleteImpact: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock('@/api/conditions', () => ({ conditionsApi: { getByExperiment: vi.fn() } }))
vi.mock('@/api/chemicals', () => ({ chemicalsApi: { listExperimentAdditives: vi.fn() } }))
vi.mock('@/api/results', () => ({ resultsApi: { getScalar: vi.fn() } }))

import { hphtApi } from '@/api/hpht'
import { experimentsApi } from '@/api/experiments'
import { chemicalsApi } from '@/api/chemicals'
import { conditionsApi } from '@/api/conditions'
import { resultsApi } from '@/api/results'
import { HphtRunPage } from '../HphtRunPage'

function result(id: number, day: number): ResultWithFlags {
  return {
    id,
    experiment_fk: 1,
    time_post_reaction_days: day,
    time_post_reaction_bucket_days: day,
    cumulative_time_post_reaction_days: day,
    is_primary_timepoint_result: true,
    created_at: '2026-09-02T00:00:00',
    has_scalar: true,
    has_icp: false,
    has_modification_note: false,
    notes: [],
    grams_per_ton_yield: null,
    h2_concentration: 1000,
    h2_grams_per_ton_yield: 0.1,
    h2_micromoles: 1.5,
    gross_ammonium_concentration_mM: null,
    background_ammonium_concentration_mM: null,
    final_conductivity_mS_cm: 4.2,
    final_ph: 7.1,
    scalar_measurement_date: '2026-09-05T00:00:00',
    ferrous_iron_yield_h2_pct: null,
    ferrous_iron_yield_nh3_pct: null,
    nmr_run_date: null,
    icp_run_date: null,
    gc_run_date: null,
    xrd_run_date: null,
    sample_tube_number: 4,
  }
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

const detailOf = (id: string) =>
  id === 'HPHT_297-2' ? SEG_2_DETAIL : { ...SEG_2_DETAIL, experiment_id: id, notes: [] }

const conditionsOf = (id: string): ConditionsResponse => ({
  id: 1, experiment_fk: 1, experiment_id: id, experiment_type: 'HPHT', reactor_number: 7,
  reactor_slot: 'R07', created_at: '2026-09-01T00:00:00',
})

function mockSegmentQueries() {
  vi.mocked(experimentsApi.get).mockImplementation(async (id: string) => detailOf(id))
  vi.mocked(conditionsApi.getByExperiment).mockImplementation(async (id: string) => conditionsOf(id))
}

function renderPage(run: HphtRun = RUN, path = `/hpht/${run.base_id}`) {
  vi.mocked(hphtApi.get).mockResolvedValue(run)
  mockSegmentQueries()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <Routes>
            <Route path="/hpht/:baseId" element={<HphtRunPage />} />
            <Route path="/hpht" element={<p>HPHT list</p>} />
          </Routes>
          <Probe />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const currentLocation = () => screen.getByTestId('location').textContent ?? ''

const samplesRegion = async () =>
  (await screen.findByRole('heading', { name: 'Samples' })).closest('section') as HTMLElement

describe('HphtRunPage (issue #150)', () => {
  beforeEach(() => {
    vi.mocked(hphtApi.get).mockReset()
    vi.mocked(hphtApi.icp).mockReset()
    vi.mocked(hphtApi.icp).mockResolvedValue([])
    vi.mocked(experimentsApi.getResults).mockReset()
    vi.mocked(experimentsApi.getResults).mockResolvedValue([])
    vi.mocked(chemicalsApi.listExperimentAdditives).mockResolvedValue([])
    vi.mocked(resultsApi.getScalar).mockReset()
  })

  it('renders the header, reactor and conditions', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'HPHT_297', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'HPHT_297-2', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Reactor R07')).toBeInTheDocument()
    const badge = screen.getByText(/^Ongoing:/)
    expect(badge).toHaveTextContent('Ongoing: HPHT_297-2')
    expect(within(badge).getByRole('link', { name: 'HPHT_297-2' })).toHaveAttribute(
      'href', '/hpht/HPHT_297?segment=HPHT_297-2',
    )
    expect(screen.getByText('1500 psi')).toBeInTheDocument()
    // The card edits in place: the Conditions tab with the card's segment selected.
    expect(screen.getByRole('link', { name: 'Edit conditions' })).toHaveAttribute(
      'href', '/hpht/HPHT_297?segment=HPHT_297-2&tab=conditions',
    )
    // The segment the card describes is a link too, not caption text (epic #154).
    const heading = screen.getByRole('heading', { name: /^Conditions/, level: 2 })
    expect(within(heading).getByRole('link', { name: 'HPHT_297-2' })).toHaveAttribute(
      'href', '/hpht/HPHT_297?segment=HPHT_297-2&tab=conditions',
    )
  })

  it('lists samples newest first with Tube and the result note, and a MOD badge', async () => {
    renderPage()
    const region = await samplesRegion()
    const rows = within(region).getAllByTestId(/^sample-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['sample-12', 'sample-11', 'sample-10'])
    expect(within(region).getByRole('columnheader', { name: 'Tube' })).toBeInTheDocument()
    // Issue #163: one note header across the three tables.
    expect(within(region).getByRole('columnheader', { name: 'Result note' })).toBeInTheDocument()
    expect(within(rows[2]).getByText('First draw')).toBeInTheDocument()
    expect(within(rows[0]).getByText('MOD')).toBeInTheDocument()
    expect(within(rows[0]).getByText('5')).toBeInTheDocument()
  })

  it('MOD and ICP flags open the note and the readings, not the editor (issue #164)', async () => {
    vi.mocked(hphtApi.icp).mockResolvedValue([
      { result_id: 12, experiment_id: 'HPHT_297-2', is_variant: false, sample_date: null,
        cumulative_time_post_reaction_days: 5, elements: { fe: 4.5 } },
    ] as never)
    renderPage()
    const region = await samplesRegion()
    const row = within(region).getByTestId('sample-12')
    await userEvent.click(within(row).getByRole('button', { name: /^Show modification for/ }))
    expect(within(region).getByRole('region', { name: 'Modification notes' })).toHaveTextContent('Topped up brine')
    const icpFlag = await within(row).findByRole('button', { name: /^Show ICP for/ })
    await userEvent.click(icpFlag)
    expect(within(region).getByText('Fe 4.5')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // No expander column: every button in the table is an ICP, MOD or DETAILS flag.
    expect(within(region).getAllByRole('button').every((b) => /^(ICP|MOD|DETAILS)/.test(b.textContent ?? ''))).toBe(true)
  })

  it('shows variants only under Side samples', async () => {
    renderPage()
    const region = await samplesRegion()
    expect(within(region).queryByTestId('sample-13')).not.toBeInTheDocument()
    // Open by default, like every section.
    const side = screen.getByRole('region', { name: 'Side samples' })
    expect(within(side).getByTestId('sample-13')).toHaveTextContent('Desorption draw')
    // Raw values only: no running-total columns.
    expect(within(side).queryByRole('columnheader', { name: 'Cum. H₂ g/t' })).not.toBeInTheDocument()
  })

  it('+ Add sample with one ongoing segment targets it with no segment select', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '+ Add sample' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByTestId('target-segment')).toHaveTextContent('HPHT_297-2')
    expect(within(dialog).queryByLabelText('Segment')).not.toBeInTheDocument()
    // Issue #161 (NAV-15): the dialog is named for the button that opened it.
    expect(within(dialog).getByRole('heading', { name: 'Add sample' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save sample' })).toBeInTheDocument()
    expect(experimentsApi.getResults).toHaveBeenCalledWith('HPHT_297-2')
  })

  it('+ Add sample with two ongoing segments shows the segment select', async () => {
    const run: HphtRun = {
      ...RUN,
      segments: RUN.segments.map((s) => (s.id === 1 ? segment({ status: 'ONGOING' }) : s)),
    }
    renderPage(run)
    await userEvent.click(await screen.findByRole('button', { name: '+ Add sample' }))
    const dialog = await screen.findByRole('dialog')
    const select = await within(dialog).findByLabelText('Segment')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toContain('HPHT_297-2 (ongoing)')
    expect(within(dialog).queryByTestId('target-segment')).not.toBeInTheDocument()
  })

  it('a row click opens edit mode for that result', async () => {
    vi.mocked(experimentsApi.getResults).mockResolvedValue([result(10, 1), result(11, 4)])
    vi.mocked(resultsApi.getScalar).mockResolvedValue({ id: 11, result_id: 11 } as never)
    renderPage()
    const region = await samplesRegion()
    await userEvent.click(within(region).getByTestId('sample-11'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/^Edit sample — T\+4/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save sample' })).toBeInTheDocument()
    expect(experimentsApi.getResults).toHaveBeenCalledWith('HPHT_297')
    await waitFor(() => expect(resultsApi.getScalar).toHaveBeenCalledWith(11))
    expect(within(dialog).queryByLabelText('Segment')).not.toBeInTheDocument()
  })

  it('renders a base_mismatch warning under Data checks', async () => {
    renderPage({ ...RUN, warnings: [{ code: 'base_mismatch', experiment_ids: ['HPHT_2970'] }] })
    expect(await screen.findByRole('button', { name: /^Data checks/ })).toHaveAttribute('aria-expanded', 'true')
    const line = screen.getByTestId('warning-base_mismatch')
    expect(line).toHaveTextContent('HPHT_2970 does not follow the run')
    expect(line).toHaveTextContent('HPHT_297')
  })

  it('shows the 404 message for an unknown run', async () => {
    vi.mocked(hphtApi.get).mockRejectedValue(Object.assign(new Error('nf'), { response: { status: 404 } }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={['/hpht/NOPE']}>
        <QueryClientProvider client={qc}>
          <ToastProvider>
            <Routes>
              <Route path="/hpht/:baseId" element={<HphtRunPage />} />
            </Routes>
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('No HPHT run NOPE')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to HPHT' })).toHaveAttribute('href', '/hpht')
    expect(screen.getByRole('link', { name: 'Open experiment NOPE' })).toHaveAttribute('href', '/experiments/NOPE')
  })
})

describe('HphtRunPage links (issue #158)', () => {
  beforeEach(() => {
    vi.mocked(hphtApi.get).mockReset()
    vi.mocked(hphtApi.icp).mockReset()
    vi.mocked(hphtApi.icp).mockResolvedValue([])
    vi.mocked(experimentsApi.getResults).mockReset()
    vi.mocked(experimentsApi.getResults).mockResolvedValue([])
    vi.mocked(chemicalsApi.listExperimentAdditives).mockResolvedValue([])
  })

  it('opens Segments for a run with several segments and links them in the summary', async () => {
    renderPage()
    const seg = await screen.findByRole('button', { name: /^Segments/ })
    expect(seg).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Segments' })).toBeInTheDocument()
    const hrefs = within(seg.parentElement!).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(RUN.segments.map((s) => `/hpht/HPHT_297?segment=${s.experiment_id}`))
  })

  it('has no Segments section for a single-segment run', async () => {
    renderPage({ ...RUN, segments: [RUN.segments[0]] })
    await screen.findByRole('heading', { name: 'Samples' })
    expect(screen.queryByRole('button', { name: /^Segments/ })).not.toBeInTheDocument()
  })

  it('links the Segment column without opening the sample editor', async () => {
    renderPage()
    const region = await samplesRegion()
    const link = within(region).getAllByRole('link', { name: 'HPHT_297-2' })[0]
    expect(link).toHaveAttribute('href', '/hpht/HPHT_297?segment=HPHT_297-2')
    await userEvent.click(link)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('replaces a segment ID in the URL with the run base ID', async () => {
    renderPage(RUN, '/hpht/HPHT_297-2')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/hpht\/HPHT_297$/))
    expect(screen.getByTestId('nav-type')).toHaveTextContent('REPLACE')
    expect(currentLocation()).toBe('/hpht/HPHT_297?segment=HPHT_297-2')
    expect(await screen.findByRole('heading', { name: 'HPHT_297', level: 1 })).toBeInTheDocument()
  })
})

/** The run a path asks for: a segment or variant ID resolves to its run, as the API does. */
function runFor(id: string): HphtRun {
  if (id === SINGLE_RUN.base_id) return SINGLE_RUN
  if (id === RUN.base_id || RUN.segments.some((s) => s.experiment_id === id)) return RUN
  return { ...SINGLE_RUN, base_id: id, segments: [segment({ id: 9, experiment_id: id })], samples: [] }
}

/** Mounts the page at `path` and waits for the segment's record header. */
async function renderRun(path: string) {
  const base = decodeURIComponent(path.split('?')[0].split('/')[2])
  vi.mocked(hphtApi.icp).mockResolvedValue([
    { result_id: 12, experiment_id: 'HPHT_297-2', is_variant: false, sample_date: null,
      cumulative_time_post_reaction_days: 8, elements: { fe: 4.5 } },
  ] as never)
  renderPage(runFor(base), path)
  vi.mocked(hphtApi.get).mockImplementation(async (id: string) => runFor(id))
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

describe('one page per run', () => {
  beforeEach(() => {
    vi.mocked(hphtApi.get).mockReset()
    vi.mocked(hphtApi.icp).mockReset()
    vi.mocked(experimentsApi.getResults).mockReset()
    vi.mocked(experimentsApi.getResults).mockResolvedValue([])
    vi.mocked(experimentsApi.get).mockClear()
    vi.mocked(experimentsApi.patch).mockReset()
    vi.mocked(chemicalsApi.listExperimentAdditives).mockResolvedValue([])
  })

  it('single-segment run: no picker, no Segments section, record header at h1', async () => {
    await renderRun('/hpht/HPHT_304')
    expect(screen.queryByRole('navigation', { name: 'Segments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /segments/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'HPHT_304' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rename experiment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete experiment/i })).toBeInTheDocument()
  })

  it('multi-segment run: picker, run heading at h1, selected segment header at h2', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    expect(screen.getByRole('navigation', { name: 'Segments' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'HPHT_297' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'HPHT_297-2' })).toBeInTheDocument()
  })

  it('marks the selected segment rows and shows the whole run', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    // Side samples are open too, so count the main table only.
    const rows = within(await samplesRegion()).getAllByTestId(/^sample-/)
    expect(rows.length).toBe(MAIN_SAMPLE_COUNT)
    expect(rows.filter((r) => r.dataset.marked === 'true').length).toBe(SEGMENT_2_SAMPLE_COUNT)
  })

  it('only=1 narrows the table to the segment', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2&only=1')
    expect(within(await samplesRegion()).getAllByTestId(/^sample-/).length).toBe(SEGMENT_2_SAMPLE_COUNT)
  })

  it('no rows are marked when the run is opened without a segment', async () => {
    await renderRun('/hpht/HPHT_297')
    expect(screen.getAllByTestId(/^sample-/).some((r) => r.dataset.marked === 'true')).toBe(false)
  })

  it('titles the charts H₂ over time and opens ICP over time', async () => {
    await renderRun('/hpht/HPHT_297')
    expect(screen.getByRole('heading', { name: /H₂ over time/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /ICP over time/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('the notes tab shows the selected segment notes, not the samples', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2&tab=notes')
    await waitFor(() => expect(experimentsApi.get).toHaveBeenCalledWith('HPHT_297-2'))
    expect(screen.queryByRole('heading', { name: 'Samples' })).not.toBeInTheDocument()
    expect(await screen.findByText('note 1')).toBeInTheDocument()
  })

  it('a segment ID in the path keeps the query and selects that segment (Review Focus 3)', async () => {
    await renderRun('/hpht/HPHT_297-2?tab=notes')
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_297?segment=HPHT_297-2&tab=notes'))
  })

  it('deleting the selected segment of a two-segment run stays on the run (Review Focus 4)', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    await deleteViaModal('HPHT_297-2')
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_297'))
  })

  it('never points at the deleted segment while the run refetches', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    // Hold the post-delete run back, so the page lives on the cached run.
    let release: (run: HphtRun) => void = () => {}
    vi.mocked(hphtApi.get).mockImplementation(() => new Promise<HphtRun>((r) => { release = r }))
    vi.mocked(experimentsApi.get).mockClear()
    await deleteViaModal('HPHT_297-2')
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_297'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 20)) // the header's deferred cache eviction

    expect(screen.queryByRole('link', { name: 'HPHT_297-2' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('sample-12')).not.toBeInTheDocument()
    expect(experimentsApi.get).not.toHaveBeenCalledWith('HPHT_297-2')

    const remaining: HphtRun = {
      ...RUN,
      segments: [RUN.segments[0]],
      samples: RUN.samples.filter((x) => x.experiment_id === 'HPHT_297'),
    }
    release(remaining)
    // The picker goes once the refetched run has a single segment left.
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Segments' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'HPHT_297' })).toBeInTheDocument()
    expect(experimentsApi.get).not.toHaveBeenCalledWith('HPHT_297-2')
  })

  it('deleting the only segment goes to the HPHT list', async () => {
    await renderRun('/hpht/HPHT_304')
    await deleteViaModal('HPHT_304')
    await waitFor(() => expect(currentLocation()).toBe('/hpht'))
  })

  it('renaming the selected segment follows it to its new home', async () => {
    vi.mocked(experimentsApi.patch).mockResolvedValue({
      ...SEG_2_DETAIL, experiment_id: 'HPHT_400', base_experiment_id: 'HPHT_400',
    })
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    await renameTo('HPHT_400')
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_400?segment=HPHT_400'))
  })
})

describe('final review fixes', () => {
  beforeEach(() => {
    vi.mocked(hphtApi.get).mockReset()
    vi.mocked(hphtApi.icp).mockReset()
    vi.mocked(experimentsApi.getResults).mockReset()
    vi.mocked(experimentsApi.getResults).mockResolvedValue([])
    vi.mocked(experimentsApi.get).mockClear()
    vi.mocked(chemicalsApi.listExperimentAdditives).mockResolvedValue([])
    vi.mocked(resultsApi.getScalar).mockReset()
  })

  it('F1: an open header editor closes when another segment is picked', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    const picker = screen.getByRole('navigation', { name: 'Segments' })
    // Visit the root first, so the -2 segment is cached and the header never unmounts.
    await userEvent.click(within(picker).getByRole('link', { name: 'HPHT_297' }))
    await screen.findByRole('heading', { level: 2, name: 'HPHT_297' })
    await userEvent.click(screen.getByTitle('Edit start date'))
    expect(screen.getByRole('button', { name: 'Save date' })).toBeInTheDocument()

    await userEvent.click(within(picker).getByRole('link', { name: 'HPHT_297-2' }))
    await screen.findByRole('heading', { level: 2, name: 'HPHT_297-2' })
    expect(screen.queryByRole('button', { name: 'Save date' })).not.toBeInTheDocument()
  })

  it('F2: data checks on a single-segment run point at the header, not Segments', async () => {
    renderPage({
      ...SINGLE_RUN,
      warnings: [
        { code: 'missing_description', experiment_ids: ['HPHT_304'] },
        { code: 'base_mismatch', experiment_ids: ['HPHT_304'] },
      ],
    })
    const missing = await screen.findByTestId('warning-missing_description')
    expect(missing).toHaveTextContent('No description on HPHT_304. Add one under the ID above.')
    expect(missing).not.toHaveTextContent(/Segments/)
    const mismatch = screen.getByTestId('warning-base_mismatch')
    expect(mismatch).toHaveTextContent(/Rename it with the pencil beside the ID above\.$/)
    expect(mismatch).not.toHaveTextContent(/Segments/)
  })

  it('F2: data checks on a multi-segment run still point at Segments', async () => {
    renderPage({ ...RUN, warnings: [{ code: 'missing_description', experiment_ids: ['HPHT_297-2'] }] })
    expect(await screen.findByTestId('warning-missing_description')).toHaveTextContent('Add one in Segments.')
  })

  it('F3: a selected side sample is marked in Side samples, and only=1 is ignored', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2_Desorption&only=1')
    const main = await samplesRegion()
    const mainRows = within(main).getAllByTestId(/^sample-/)
    expect(mainRows.length).toBe(MAIN_SAMPLE_COUNT)
    expect(mainRows.some((r) => r.dataset.marked === 'true')).toBe(false)
    expect(screen.getByRole('button', { name: /^Side samples/ })).toHaveAttribute('aria-expanded', 'true')
    const side = screen.getByRole('region', { name: 'Side samples' })
    expect(within(side).getByTestId('sample-13')).toHaveAttribute('data-marked', 'true')
    expect(screen.queryByRole('link', { name: /only this segment/i })).not.toBeInTheDocument()
  })

  it('F9: DETAILS on a run page sample loads its DO and Fe(II)', async () => {
    vi.mocked(resultsApi.getScalar).mockResolvedValue({
      id: 1, result_id: 11, final_dissolved_oxygen_mg_L: 3.2, ferrous_iron_yield: null,
    } as never)
    await renderRun('/hpht/HPHT_297')
    const row = within(await samplesRegion()).getByTestId('sample-11')
    expect(resultsApi.getScalar).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: /^Show details for/ }))
    await waitFor(() => expect(resultsApi.getScalar).toHaveBeenCalledWith(11))
    expect(await screen.findByText('DO:')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
