# One Page Per Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every HPHT and Core Flood experiment one page (the run page, with the segment page's tabs folded in), open every other experiment on its results, and make the Experiments list show more description with a clickable group flag.

**Architecture:** The run pages gain URL state (`?segment=&only=&tab=`), a segment picker, and a tab bar whose non-Results tabs render the detail page's existing tab components for the selected segment. The detail page's header is extracted into a reusable component so the run page can host it, and `/experiments/{id}` redirects to the run page for run segments. Frontend only.

**Tech Stack:** React 18, TypeScript, React Router 6, TanStack Query, Tailwind 3.4, Recharts, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-one-page-per-run-design.md`

## Global Constraints

- Frontend only: no file outside `frontend/src/` and `docs/` changes. No API, schema, view, calculation or package change (`package.json` and `package-lock.json` untouched).
- Branch `feat/segment-run-clarity` (exists, from `develop`). Commit format: `[feat|refactor|chore] <imperative, under 50 chars>` with the `Tests added` / `Docs updated` lines.
- Tailwind utility classes only; no hex values; no inline styles; no `useEffect` + `useState` data fetching; no `console.log`.
- Query keys are shared, never re-spelled: `['experiment', id]`, `['conditions', id]`, `HPHT_WRITES.runQueryKey(base)`, `CORE_FLOOD_WRITES.runQueryKey(base)`.
- `tab` URL values are exactly `results`, `conditions`, `notes`, `xrd`, `logs`.
- Serum type checks use `isSerumType` / `isHphtType` / `isCoreFloodType`, never a string literal.
- Never start or stop the Vite dev server (assume `:5173`). Run one test process at a time.
- Test command for one file: `cd frontend && npx vitest run <path>`. Full gate: `npm test && npm run lint && npm run type-check`, all exit 0 (lint and type-check baseline is zero).

## Review Focus

1. **A segment ID whose run cannot load** (run endpoint 404 or error, or `base_experiment_id` null): the user expects the old detail page, not a spinner or a redirect loop. Test in Task 7.
2. **`?segment=` naming an ID that is not in the run** (stale bookmark, renamed or deleted segment): expect the default segment and no marked rows, not a crash or an empty page. Test in Task 1.
3. **A segment ID typed into the run URL** (`/hpht/HPHT_297-2?tab=notes`): `useCanonicalRunUrl` rewrites the path today and would drop the query string; expect `?tab=notes` to survive and the typed segment to be selected. Test in Task 5.
4. **Deleting or renaming the selected segment on the run page**: expect to stay on the run (or follow it to its new base), or go to the run list when it was the last segment; never a page pointing at a dead ID. Test in Task 5.
5. **A group row with no replicate letters** (letterless `-t` vial set): the group flag has nothing to expand; expect a non-interactive badge with the vial count, not a button that does nothing. Test in Task 8.

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/utils/experimentId.ts` (modify) | add `experimentHomePath` |
| `frontend/src/components/runs/runView.ts` (create) | pure URL-state helpers for a run page |
| `frontend/src/components/runs/SegmentPicker.tsx` (create) | the picker chips and "only" toggle |
| `frontend/src/components/runs/RunTabs.tsx` (create) | tab bar; record tabs for one segment |
| `frontend/src/components/runs/H2Charts.tsx` (moved from `pages/Hpht/HphtCharts.tsx`) | H₂ charts for both run kinds |
| `frontend/src/components/runs/h2Series.ts` (moved from `pages/Hpht/hphtSeries.ts`) | chart point helpers |
| `frontend/src/components/experiments/ExperimentRecordHeader.tsx` (create) | ID row, description, meta line, actions, modals |
| `frontend/src/components/experiments/RunContextHeader.tsx` (modify) | becomes `ExperimentBreadcrumb` + `GroupStrip` |
| `frontend/src/components/results/RunSamplesTable.tsx`, `components/runs/SegmentLink.tsx`, `components/runs/runPageNav.tsx` (modify) | in-page segment links, marked rows, query-preserving canonical URL |
| `frontend/src/pages/Hpht/HphtRunPage.tsx`, `pages/CoreFloods/CoreFloodRunPage.tsx` (modify) | compose the above |
| `frontend/src/pages/ExperimentDetail/index.tsx`, `IcpSection.tsx` (modify) | redirect, Results default, ICP open |
| `frontend/src/pages/ExperimentList.tsx`, `pages/ReactorGrid.tsx`, `pages/Hpht/ConditionsSummaryCard.tsx` (modify) | single-destination links, list columns |

---

### Task 1: Path helper and run-view URL state

**Files:**
- Modify: `frontend/src/utils/experimentId.ts`
- Create: `frontend/src/components/runs/runView.ts`
- Test: `frontend/src/utils/__tests__/experimentHomePath.test.ts`, `frontend/src/components/runs/__tests__/runView.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // utils/experimentId.ts
  export function experimentHomePath(
    experimentType: unknown, experimentId: string, baseId: string | null | undefined, tab?: string,
  ): string

  // components/runs/runView.ts
  export const RUN_TABS = ['results', 'conditions', 'notes', 'xrd', 'logs'] as const
  export type RunTab = typeof RUN_TABS[number]
  export const RUN_TAB_LABEL: Record<RunTab, string>   // Results, Conditions, Notes, XRD, Entry Logs
  export interface RunView {
    tab: RunTab
    /** Always a segment of the run. */
    segmentId: string
    /** True when the URL named this segment; false when it is the default. */
    explicit: boolean
    /** Samples table narrowed to the segment. Only true when `explicit` and the run has >1 segment. */
    only: boolean
  }
  export function defaultSegment(segments: RunSegment[]): RunSegment | undefined
  export function runViewFrom(params: URLSearchParams, segments: RunSegment[]): RunView | null  // null when segments is empty
  /** Search string (with leading '?', or '' when empty) for a change to the view. `segmentId: null` clears segment and only. */
  export function runViewSearch(
    current: URLSearchParams, change: { tab?: RunTab; segmentId?: string | null; only?: boolean },
  ): string
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// experimentHomePath.test.ts
it.each([
  ['HPHT', 'HPHT_297-2', 'HPHT_297', undefined, '/hpht/HPHT_297?segment=HPHT_297-2'],
  ['Core Flood', 'CF_027-6', 'CF_027', 'notes', '/core-floods/CF_027?segment=CF_027-6&tab=notes'],
  ['hpht', 'HPHT_304', 'HPHT_304', undefined, '/hpht/HPHT_304?segment=HPHT_304'],
  ['Serum', 'SERUM_001a', 'SERUM_001', undefined, '/experiments/SERUM_001a'],
  ['SERUM', 'SERUM_001a', 'SERUM_001', 'results', '/experiments/SERUM_001a?tab=results'],
  ['HPHT', 'HPHT_X', null, undefined, '/experiments/HPHT_X'],          // no base: no run page
  [null, 'A/B', null, undefined, '/experiments/A%2FB'],
])('%s %s -> %s', (type, id, base, tab, expected) => {
  expect(experimentHomePath(type, id, base, tab)).toBe(expected)
})
```

```ts
// runView.test.ts — seg(id, {status, date, is_variant}) builds a RunSegment
const two = [seg('HPHT_297', { status: 'COMPLETED', date: '2026-09-01' }),
             seg('HPHT_297-2', { status: 'COMPLETED', date: '2026-10-09' })]

it('defaults to the latest segment, results tab, not explicit', () => {
  expect(runViewFrom(new URLSearchParams(''), two))
    .toEqual({ tab: 'results', segmentId: 'HPHT_297-2', explicit: false, only: false })
})
it('prefers the first ONGOING non-variant segment as the default', () => {
  const segs = [seg('A', { status: 'ONGOING', date: '2026-01-01' }), seg('A-2', { status: 'QUEUED', date: '2026-02-01' }),
                seg('A_Blank', { status: 'ONGOING', is_variant: true })]
  expect(defaultSegment(segs)?.experiment_id).toBe('A')
})
it('reads segment, only and tab', () => {
  expect(runViewFrom(new URLSearchParams('segment=HPHT_297&only=1&tab=NOTES'), two))
    .toEqual({ tab: 'notes', segmentId: 'HPHT_297', explicit: true, only: true })
})
it('falls back when the segment is not in the run (Review Focus 2)', () => {
  expect(runViewFrom(new URLSearchParams('segment=HPHT_999&only=1&tab=bogus'), two))
    .toEqual({ tab: 'results', segmentId: 'HPHT_297-2', explicit: false, only: false })
})
it('ignores only on a single-segment run', () => {
  expect(runViewFrom(new URLSearchParams('segment=HPHT_304&only=1'), [seg('HPHT_304')])!.only).toBe(false)
})
it('returns null for a run with no segments', () => {
  expect(runViewFrom(new URLSearchParams(''), [])).toBeNull()
})
it('builds search strings, keeping unrelated params', () => {
  const cur = new URLSearchParams('segment=HPHT_297&only=1&tab=notes')
  expect(runViewSearch(cur, { tab: 'results' })).toBe('?segment=HPHT_297&only=1')   // results is the default: omitted
  expect(runViewSearch(cur, { segmentId: 'HPHT_297-2' })).toBe('?segment=HPHT_297-2&only=1&tab=notes')
  expect(runViewSearch(cur, { segmentId: null })).toBe('?tab=notes')
  expect(runViewSearch(cur, { only: false })).toBe('?segment=HPHT_297&tab=notes')
  expect(runViewSearch(new URLSearchParams(''), { tab: 'results' })).toBe('')
})
```

- [ ] **Step 2: Run both files; expect FAIL** (`experimentHomePath` / `runView` not found).
- [ ] **Step 3: Implement.** `experimentHomePath` builds on `runPathFor` (which already encodes the base) and encodes `experimentId` in both branches. `defaultSegment` = first non-variant segment with status `ONGOING` (case-insensitive) in array order, else `latestSegment(segments)` from `runSegments.ts`. `runViewSearch` writes params in the fixed order `segment`, `only`, `tab`.
- [ ] **Step 4: Run both files; expect PASS.**
- [ ] **Step 5: Commit** — `[feat] Add experiment home path and run view state`

---

### Task 2: H₂ charts for both run kinds

**Files:**
- Move: `frontend/src/pages/Hpht/HphtCharts.tsx` → `frontend/src/components/runs/H2Charts.tsx`; `frontend/src/pages/Hpht/hphtSeries.ts` → `frontend/src/components/runs/h2Series.ts`; `frontend/src/pages/Hpht/__tests__/hphtCharts.test.ts` → `frontend/src/components/runs/__tests__/h2Series.test.ts` (use `git mv`)
- Modify: `frontend/src/pages/Hpht/HphtRunPage.tsx` (import only), `frontend/src/pages/Hpht/index.ts` if it re-exports either

**Interfaces:**
- Produces:
  ```ts
  // h2Series.ts
  export interface H2Sample {
    result_id: number
    experiment_id: string
    is_variant: boolean
    cumulative_time_post_reaction_days: number | null
    h2_grams_per_ton_yield: number | null
    cumulative_h2_grams_per_ton: number | null
    h2_grams_per_ton_per_day: number | null
    cumulative_ferrous_iron_yield_h2_pct?: number | null   // absent on core flood samples
  }
  export interface H2Point { day: number; cumH2: number | null; rate: number | null; cumFe: number | null }
  export function chartPoints(samples: H2Sample[]): H2Point[]
  export function hasH2(samples: H2Sample[]): boolean
  export function hasFeYield(points: H2Point[]): boolean
  export function chartMarkers(samples: H2Sample[]): ChartMarker[]
  // H2Charts.tsx
  export function H2Charts({ samples }: { samples: H2Sample[] }): JSX.Element
  ```
  `HphtSample` and `CoreFloodSample` are both assignable to `H2Sample` without a cast.

- [ ] **Step 1: Move the three files and update imports**; rename `HphtPoint` → `H2Point`, `HphtCharts` → `H2Charts`. Run the moved test; expect PASS (pure move).
- [ ] **Step 2: Add failing tests** to `h2Series.test.ts`:

```ts
it('maps a sample without an Fe yield field to cumFe null', () => {
  const cf = { result_id: 1, experiment_id: 'CF_027', is_variant: false, cumulative_time_post_reaction_days: 3,
               h2_grams_per_ton_yield: 1, cumulative_h2_grams_per_ton: 4, h2_grams_per_ton_per_day: 0.5 }
  expect(chartPoints([cf])).toEqual([{ day: 3, cumH2: 4, rate: 0.5, cumFe: null }])
})
it('hasFeYield is false when no point carries one, true otherwise', () => {
  expect(hasFeYield([{ day: 1, cumH2: 1, rate: 1, cumFe: null }])).toBe(false)
  expect(hasFeYield([{ day: 1, cumH2: 1, rate: 1, cumFe: 0.2 }])).toBe(true)
})
```

- [ ] **Step 3: Run; expect FAIL** (`hasFeYield` not defined; `cumFe` is `undefined`).
- [ ] **Step 4: Implement.** In `H2Charts`, drop the `cumFe` chart spec when `!hasFeYield(points)` and size the grid to the charts shown (`xl:grid-cols-2` for two, `xl:grid-cols-3` for three). Empty-state text becomes `No H₂ measurements on this run yet.` (unchanged).
- [ ] **Step 5: Run `npx vitest run src/components/runs src/pages/Hpht`; expect PASS.**
- [ ] **Step 6: Commit** — `[refactor] Share H2 charts across run kinds`

---

### Task 3: Extract the experiment record header

A pure refactor of `ExperimentDetail/index.tsx:108-545` so the run page can host the same header. No behaviour change on the detail page.

**Files:**
- Create: `frontend/src/components/experiments/ExperimentRecordHeader.tsx`
- Modify: `frontend/src/pages/ExperimentDetail/index.tsx`, `frontend/src/components/experiments/RunContextHeader.tsx`
- Test: existing `frontend/src/pages/ExperimentDetail/__tests__/*`, `frontend/src/components/experiments/__tests__/RunContextHeader.test.tsx`; new `frontend/src/components/experiments/__tests__/ExperimentRecordHeader.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // ExperimentRecordHeader.tsx
  export interface ExperimentRecordHeaderProps {
    experiment: ExperimentDetail
    conditions: ExperimentalConditions | null | undefined   // the type conditionsApi.getByExperiment returns
    /** Rendered between the ID row and the description (the detail page's group strip). */
    belowId?: ReactNode
    /** Offers "Mark as outlier" (replicate sets only). */
    inReplicateSet?: boolean
    /** `'h1'` on the detail page and on a single-segment run; `'h2'` under a run heading. Default 'h1'. */
    headingLevel?: 'h1' | 'h2'
    /** Hide "+ New Experiment", "Create Replicates" and "Export all" (the run page has its own). Default false. */
    embedded?: boolean
    /** Plain "Reactor R09" text instead of a link to the run (the header already sits on the run page). Default false. */
    reactorAsText?: boolean
    onRenamed: (updated: ExperimentDetail) => void
    onDeleted: (deletedId: string) => void
  }
  export function ExperimentRecordHeader(props: ExperimentRecordHeaderProps): JSX.Element

  // RunContextHeader.tsx — replaces the RunContextHeader export
  export function ExperimentBreadcrumb(props: {
    experiment: Pick<ExperimentDetail, 'experiment_id' | 'base_experiment_id' | 'replicate_label'>
    experimentType: string | null | undefined
    replicateGroup: ReplicateGroup | undefined
    groupMemberCount: number | undefined
  }): JSX.Element
  export function GroupStrip(props: {
    experiment: Pick<ExperimentDetail, 'id' | 'experiment_id' | 'base_experiment_id' | 'replicate_label'>
    replicateGroup: ReplicateGroup | undefined
    groupMemberCount: number | undefined
  }): JSX.Element | null
  ```

- [ ] **Step 1: Write the failing test** (`ExperimentRecordHeader.test.tsx`, mocking `experimentsApi` as `DescriptionEdit.test.tsx` does):

```tsx
it('embedded hides New Experiment, Create Replicates and Export, keeps Delete and background', () => {
  renderHeader({ embedded: true })
  expect(screen.queryByRole('button', { name: /new experiment/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /create replicates/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /export all/i })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /mark as background/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /delete experiment/i })).toBeInTheDocument()
})
it('renders the ID at the requested heading level', () => {
  renderHeader({ headingLevel: 'h2' })
  expect(screen.getByRole('heading', { level: 2, name: 'HPHT_297-2' })).toBeInTheDocument()
})
it('reactorAsText prints the slot with no link', () => {
  renderHeader({ reactorAsText: true })   // conditions: experiment_type HPHT, reactor_slot R09
  expect(screen.getByText(/Reactor R09/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Reactor R09/ })).not.toBeInTheDocument()
})
it('calls onRenamed with the server response after a rename', async () => {
  const onRenamed = vi.fn()
  vi.mocked(experimentsApi.patch).mockResolvedValue({ ...EXP, experiment_id: 'HPHT_297-3' })
  renderHeader({ onRenamed })
  await user.click(screen.getByRole('button', { name: /rename experiment/i }))
  await user.clear(screen.getByRole('textbox')); await user.type(screen.getByRole('textbox'), 'HPHT_297-3{Enter}')
  await waitFor(() => expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ experiment_id: 'HPHT_297-3' })))
})
```

- [ ] **Step 2: Run; expect FAIL** (module not found).
- [ ] **Step 3: Move the code.** Into `ExperimentRecordHeader`: the editing state (`editingId`, `idDraft`, `editingDate`, `dateDraft`, `editingSampleId`, `sampleDraft`, `replicatesOpen`, `deleteOpen`), the five mutations, `useExperimentIdValidation`, the ID row, `DescriptionEditor`, the meta line, the inline sample editor, the Quick actions row, and both modals. The cache eviction that follows a delete (`PER_EXPERIMENT_QUERY_KEYS`, `GROUP_QUERY_PREFIXES`, the `setTimeout`) moves with it and runs inside the component *after* it calls `onDeleted(deletedId)`, so the caller navigates first, as today. `onRenamed` replaces the inline `navigate`. In `RunContextHeader.tsx`: split into `ExperimentBreadcrumb` (the breadcrumb, unchanged rules) and `GroupStrip` (the serum strip, unchanged); delete the run strip and its `useQuery` (Task 7 redirects run segments, so it becomes unreachable). `index.tsx` composes `<ExperimentBreadcrumb/>` then `<ExperimentRecordHeader belowId={<GroupStrip/>} inReplicateSet={…} onRenamed={(u) => navigate(`/experiments/${u.experiment_id}`, { replace: true })} onDeleted={() => navigate('/experiments', { replace: true })} />`.
- [ ] **Step 4: Update `RunContextHeader.test.tsx`.** Delete the three cases that assert the run strip (`names the HPHT run…` strip assertions, `links a core flood variant…`, `hides the strip when the run cannot be loaded…`); keep their breadcrumb assertions and every group-strip case. They are re-covered by Task 7's redirect tests.
- [ ] **Step 5: Run `npx vitest run src/pages/ExperimentDetail src/components/experiments`; expect PASS** with no other test edited.
- [ ] **Step 6: Commit** — `[refactor] Extract experiment record header`

---

### Task 4: Segment picker, run tabs, in-page segment links

**Files:**
- Create: `frontend/src/components/runs/SegmentPicker.tsx`, `frontend/src/components/runs/RunTabs.tsx`
- Modify: `frontend/src/components/runs/SegmentLink.tsx`, `frontend/src/components/runs/runPageNav.tsx`, `frontend/src/components/results/RunSamplesTable.tsx`
- Test: `frontend/src/components/runs/__tests__/SegmentPicker.test.tsx`, `RunTabs.test.tsx`, additions to `SegmentLink.test.tsx` and `frontend/src/components/results/__tests__/RunSamplesTable.test.tsx`

**Interfaces:**
- Consumes: `RunView`, `RunTab`, `RUN_TABS`, `RUN_TAB_LABEL`, `runViewSearch` (Task 1); `stripOrder` from `components/experiments/runContext.ts`.
- Produces:
  ```ts
  // SegmentPicker.tsx — returns null when segments.length <= 1
  export function SegmentPicker(props: { segments: RunSegment[]; view: RunView }): JSX.Element | null
  // RunTabs.tsx
  export function RunTabs(props: {
    view: RunView
    /** The Results tab's content (run level). */
    results: ReactNode
  }): JSX.Element
  // SegmentLink.tsx — new optional prop
  to?: string            // overrides the default /experiments/{id} destination
  // runPageNav.tsx — SegmentIdList new optional prop
  hrefFor?: (id: string) => string
  // RunSamplesTable.tsx — new optional props
  segmentHref?: (experimentId: string) => string
  markedExperimentId?: string
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// SegmentPicker.test.tsx — rendered at /hpht/HPHT_297?tab=notes inside MemoryRouter
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
  expect(screen.getByRole('link', { name: "Only this segment's samples" })).toHaveAttribute('href', expect.stringContaining('only=1'))
})
it('hides the only toggle while Whole run is current', () => {
  renderPicker(two, view({ segmentId: 'HPHT_297-2', explicit: false }))
  expect(screen.queryByRole('link', { name: /only this segment/i })).not.toBeInTheDocument()
})

// RunTabs.test.tsx — experimentsApi.get and conditionsApi.getByExperiment mocked
it('shows the results node on the results tab', () => {
  renderTabs(view({ tab: 'results' }), <p>RESULTS</p>)
  expect(screen.getByText('RESULTS')).toBeInTheDocument()
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

// SegmentLink.test.tsx
it('uses `to` when given', () => {
  render(<MemoryRouter><SegmentLink id="HPHT_297-2" to="?segment=HPHT_297-2" /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'HPHT_297-2' })).toHaveAttribute('href', '/?segment=HPHT_297-2')
})

// RunSamplesTable.test.tsx
it('links the Segment column through segmentHref and marks the selected segment rows', () => {
  renderTable({ scope: 'run', kind: 'hpht', segmentHref: (id) => `?segment=${id}`, markedExperimentId: 'HPHT_297-2' })
  expect(screen.getAllByRole('link', { name: 'HPHT_297-2' })[0]).toHaveAttribute('href', expect.stringContaining('segment=HPHT_297-2'))
  // Use the result ids of this file's fixture rows: one HPHT_297-2 row, one HPHT_297 row.
  expect(screen.getByTestId(`sample-${SEG_2_ROW.resultId}`)).toHaveAttribute('data-marked', 'true')
  expect(screen.getByTestId(`sample-${ROOT_ROW.resultId}`)).not.toHaveAttribute('data-marked')
})
```

- [ ] **Step 2: Run the four files; expect FAIL.**
- [ ] **Step 3: Implement.**
  - `SegmentPicker`: `<nav aria-label="Segments">`; links built with `runViewSearch(useSearchParams()[0], …)` relative to the current path; segments in `stripOrder`; an `Ongoing` badge beside ONGOING segments; "Whole run" is `aria-current` when `!view.explicit`. The only-toggle is a link (label `Only this segment's samples`, or `All of the run's samples` when `view.only`).
  - `RunTabs`: tab bar of `<Link>`s (classes copied from the detail page's tab bar; `aria-current="page"` on the active one) built with `runViewSearch`. For a non-results tab: `useQuery(['experiment', segmentId])` + `useQuery(['conditions', segmentId], retry: false)`, a one-line caption `{RUN_TAB_LABEL[tab]} of {segmentId}`, then `ConditionsTab` / `NotesTab key={segmentId}` / `AnalysisTab` / `ModificationsTab` with exactly the props `ExperimentDetail/index.tsx:577-597` passes. The experiment query is always enabled so the Notes and Entry Logs counts show on every tab. Wrap the record tabs in the detail page's card (`bg-surface-card border border-surface-border rounded-lg overflow-hidden`); render `results` unwrapped.
  - `RunSamplesTable`: the Segment cell calls `<SegmentLink id to={segmentHref?.(id)} />` — because `SAMPLE_COLUMNS` cells take only the row, special-case `c.key === 'segment'` in the body loop as `note` already is. A marked row gets `data-marked="true"` and `border-l-2 border-brand-red` on its first cell.
- [ ] **Step 4: Run the four files; expect PASS.**
- [ ] **Step 5: Commit** — `[feat] Add segment picker and run tabs`

---

### Task 5: HPHT run page becomes the single page

**Files:**
- Modify: `frontend/src/pages/Hpht/HphtRunPage.tsx`, `frontend/src/pages/Hpht/ConditionsSummaryCard.tsx`, `frontend/src/components/runs/runPageNav.tsx`
- Test: `frontend/src/pages/Hpht/__tests__/HphtRunPage.test.tsx`

**Interfaces:**
- Consumes: `runViewFrom`, `runViewSearch` (Task 1); `H2Charts` (Task 2); `ExperimentRecordHeader` (Task 3); `SegmentPicker`, `RunTabs`, `segmentHref`, `markedExperimentId`, `SegmentIdList.hrefFor` (Task 4).
- Produces: `useCanonicalRunUrl` keeps the query string and, when the URL held a segment ID and no `segment` param, adds `segment=<that id>`. `ConditionsSummaryCard` gains `conditionsHref: string` (replaces its hard-coded `/experiments/{id}?tab=conditions` link and the heading's `SegmentLink` destination).

- [ ] **Step 1: Write the failing tests.** `fixtures.ts` exports `RUN` (base `HPHT_297`: segments `HPHT_297`, `HPHT_297-2` and the variant `HPHT_297-2_Desorption`) and the `segment()` / `sample()` builders. Add to `fixtures.ts`: `SINGLE_RUN` (base `HPHT_304`, one segment, built with the builders), `MAIN_SAMPLE_COUNT` and `SEGMENT_2_SAMPLE_COUNT` (counts of `RUN`'s non-variant samples, all and for `HPHT_297-2`), and `SEG_2_DETAIL` (an `ExperimentDetail` for `HPHT_297-2` with 4 notes). Add a `renderRun(path)` helper that mounts the page at `path` with a location probe (`currentLocation()` returns `pathname + search`) and mocks `experimentsApi.get` / `conditionsApi.getByExperiment` for whichever segment is asked for:

```tsx
describe('one page per run', () => {
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
    const rows = screen.getAllByTestId(/^sample-/)
    expect(rows.length).toBe(MAIN_SAMPLE_COUNT)               // fixture constant
    expect(rows.filter((r) => r.dataset.marked === 'true').length).toBe(SEGMENT_2_SAMPLE_COUNT)
  })
  it('only=1 narrows the table to the segment', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2&only=1')
    expect(screen.getAllByTestId(/^sample-/).length).toBe(SEGMENT_2_SAMPLE_COUNT)
  })
  it('no rows are marked when the run is opened without a segment', async () => {
    await renderRun('/hpht/HPHT_297')
    expect(screen.getAllByTestId(/^sample-/).some((r) => r.dataset.marked === 'true')).toBe(false)
  })
  it('titles the charts H₂ over time and opens ICP over time', async () => {
    await renderRun('/hpht/HPHT_297')
    expect(screen.getByRole('heading', { name: /H₂ over time/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ICP over time/i })).toHaveAttribute('aria-expanded', 'true')
  })
  it('the notes tab shows the selected segment notes, not the samples', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2&tab=notes')
    await waitFor(() => expect(experimentsApi.get).toHaveBeenCalledWith('HPHT_297-2'))
    expect(screen.queryByRole('heading', { name: 'Samples' })).not.toBeInTheDocument()
  })
  it('a segment ID in the path keeps the query and selects that segment (Review Focus 3)', async () => {
    await renderRun('/hpht/HPHT_297-2?tab=notes')     // hphtApi.get resolves to the HPHT_297 run
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_297?segment=HPHT_297-2&tab=notes'))
  })
  it('deleting the selected segment of a two-segment run stays on the run (Review Focus 4)', async () => {
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    await deleteViaModal('HPHT_297-2')                // types the ID, confirms; experimentsApi.delete mocked
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_297'))
  })
  it('deleting the only segment goes to the HPHT list', async () => {
    await renderRun('/hpht/HPHT_304')
    await deleteViaModal('HPHT_304')
    await waitFor(() => expect(currentLocation()).toBe('/hpht'))
  })
  it('renaming the selected segment follows it to its new home', async () => {
    vi.mocked(experimentsApi.patch).mockResolvedValue({ ...SEG_2_DETAIL, experiment_id: 'HPHT_400', base_experiment_id: 'HPHT_400' })
    await renderRun('/hpht/HPHT_297?segment=HPHT_297-2')
    await renameTo('HPHT_400')
    await waitFor(() => expect(currentLocation()).toBe('/hpht/HPHT_400?segment=HPHT_400'))
  })
})
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** in `HphtRunPage`:
  - `const [params] = useSearchParams()`; `const view = runViewFrom(params, run.segments)`; when `view` is null (a run with no segments) render the page as today without picker, header or tabs.
  - Header block: multi-segment keeps today's run heading (`h1`, run description, reactor, Ongoing badge with `SegmentIdList hrefFor`), then `<SegmentPicker/>`, then `<ExperimentRecordHeader headingLevel="h2" embedded reactorAsText … />` for `view.segmentId`. Single-segment drops the run heading and description (the record header carries both) and renders `<ExperimentRecordHeader headingLevel="h1" embedded reactorAsText … />` under the breadcrumb; the reactor and Ongoing line stays.
  - The record header's `experiment` and `conditions` come from the same two queries `RunTabs` uses (same keys, so one request each); show the header once the experiment has loaded.
  - `onRenamed={(u) => navigate(experimentHomePath('HPHT', u.experiment_id, u.base_experiment_id ?? u.experiment_id), { replace: true })}` after `invalidateHphtWrites(qc, run.base_id, [old id])`.
  - `onDeleted`: `run.segments.length > 1` → `invalidateHphtWrites(qc, run.base_id, [id])` and `navigate(HPHT_WRITES.runPath(run.base_id), { replace: true })`; else `qc.removeQueries({ queryKey: HPHT_WRITES.runQueryKey(run.base_id) })`, invalidate `['hpht-runs']`, `navigate('/hpht', { replace: true })` (the rule `SegmentsTable.tsx:144-158` already applies).
  - `<RunTabs view={view} results={…} />` where `results` is today's body in this order: `ConditionsSummaryCard`, Samples, H₂ over time, ICP over time (`defaultOpen`), Side samples, Segments (only when `run.segments.length > 1`), Data checks.
  - Samples rows: `view.only ? main.filter((s) => s.experiment_id === view.segmentId) : main`; `markedExperimentId={view.explicit && run.segments.length > 1 ? view.segmentId : undefined}`; `segmentHref={(id) => runViewSearch(params, { segmentId: id })}`. Pass the same `segmentHref` to the Side samples table and `hrefFor` to both `SegmentIdList`s.
  - Section heading `Run to date` → `H₂ over time`.
  - `ConditionsSummaryCard conditionsHref={runViewSearch(params, { segmentId: run.conditions?.experiment_id, tab: 'conditions' })}`; link text `Edit conditions`.
  - `useCanonicalRunUrl`: build the target as `writes.runPath(run.base_id)` + the current search, adding `segment=requestedId` when the search has none and `requestedId` is one of `run.segments`. It needs the segments, so widen its `run` parameter to `{ base_id: string; segments: { experiment_id: string }[] } | undefined`.
- [ ] **Step 4: Update the existing cases this changes:** `renders the header, reactor and conditions` (single-segment fixture now has the record header), `opens Segments for a run with several segments…` and `links the Segment column…` (hrefs are now `?segment=`), `keeps Segments closed for a single-segment run` (now: no Segments section), `replaces a segment ID in the URL…` (target gains `?segment=`).
- [ ] **Step 5: Run `npx vitest run src/pages/Hpht src/components/runs`; expect PASS.**
- [ ] **Step 6: Commit** — `[feat] Fold segment record into HPHT run page`

---

### Task 6: Core Flood run page, same treatment plus H₂ charts

**Files:**
- Modify: `frontend/src/pages/CoreFloods/CoreFloodRunPage.tsx`
- Test: `frontend/src/pages/CoreFloods/__tests__/CoreFloodRunPage.test.tsx`

**Interfaces:**
- Consumes: everything Task 5 consumes, with `CORE_FLOOD_WRITES` and `experimentHomePath('Core Flood', …)`.

- [ ] **Step 1: Write the failing tests**, mirroring Task 5 with the file's own `RUN` fixture (base `CF_020`, several segments; use its base ID in place of `CF_027` below, and derive a one-segment run from it with `withWarnings([], [RUN.segments[0]])`): single-segment (no picker, record header at `h1`), multi-segment with `?segment=` (marked rows, `h2` header), `only=1`, notes tab loads the segment, delete-selected stays on the run, delete-last goes to `/core-floods`; plus:

```tsx
it('shows H₂ over time with no Fe²⁺ yield chart', async () => {
  await renderRun('/core-floods/CF_027')
  expect(screen.getByRole('heading', { name: /H₂ over time/i })).toBeInTheDocument()
  expect(screen.getByRole('figure', { name: 'Cumulative H₂' })).toBeInTheDocument()
  expect(screen.queryByRole('figure', { name: /Fe²⁺/ })).not.toBeInTheDocument()
})
it('opens ICP over time by default', async () => {
  await renderRun('/core-floods/CF_027')
  expect(screen.getByRole('button', { name: /ICP over time/i })).toHaveAttribute('aria-expanded', 'true')
})
it('CleanupPanel rename still opens Segments on a multi-segment run', async () => { /* existing case, kept */ })
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** exactly as Task 5 Step 3 with these differences: no `ConditionsSummaryCard`; a new `H₂ over time` card (`<H2Charts samples={run.samples} />`) directly under Samples; Results order is Samples, H₂ over time, ICP over time, Side samples, Segments (multi only), Data checks, Run totals. On a single-segment run the `CleanupPanel` `onRename` / `onEditDescription` handlers have no Segments table to open: point both at the record header instead by scrolling it into view (`document.getElementById('record-header')?.scrollIntoView()`; give the header wrapper that id on both run pages).
- [ ] **Step 4: Update existing cases** whose hrefs or Segments expectations changed, as in Task 5 Step 4.
- [ ] **Step 5: Run `npx vitest run src/pages/CoreFloods`; expect PASS.**
- [ ] **Step 6: Commit** — `[feat] Fold segment record into core flood page`

---

### Task 7: Detail page redirects run segments and opens on Results

**Files:**
- Modify: `frontend/src/pages/ExperimentDetail/index.tsx`, `frontend/src/pages/ExperimentDetail/IcpSection.tsx`, `frontend/src/pages/ExperimentDetail/ResultsTab.tsx`
- Test: `frontend/src/pages/ExperimentDetail/__tests__/RunRedirect.test.tsx` (new), `Tabs.test.tsx`, `IcpSection.test.tsx`

**Interfaces:**
- Consumes: `experimentHomePath` (Task 1); `runKindFor` (`components/experiments/runContext.ts`).

- [ ] **Step 1: Write the failing tests**

```tsx
// RunRedirect.test.tsx — routes: /experiments/:id -> ExperimentDetailPage, /hpht/:baseId and /core-floods/:baseId -> probes printing location
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
it('renders the detail page when the run cannot be loaded (Review Focus 1)', async () => {
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
})
it('does not query a run or redirect for a serum experiment', async () => {
  mockExperiment({ experiment_id: 'SERUM_001a', base_experiment_id: 'SERUM_001' }, { experiment_type: 'Serum' })
  renderAt('/experiments/SERUM_001a')
  expect(await screen.findByRole('heading', { level: 1, name: 'SERUM_001a' })).toBeInTheDocument()
  expect(hphtApi.get).not.toHaveBeenCalled()
  expect(coreFloodsApi.get).not.toHaveBeenCalled()
})
```

In `Tabs.test.tsx`, change the default-tab table rows `['?tab=bogus', 'Conditions']` and `['', 'Conditions']` to `'Results'`, and assert the tab order is `Results, Conditions, Notes, XRD, Entry Logs`. In `IcpSection.test.tsx`, assert the `ICP over time` button has `aria-expanded="true"` on first render.

- [ ] **Step 2: Run the three files; expect FAIL.**
- [ ] **Step 3: Implement.**
  - `index.tsx`: `TABS` becomes `['Results', 'Conditions', 'Notes', 'XRD', 'Entry Logs']`; `tabFromParam` falls back to `'Results'`.
  - After `experiment` and `conditions` resolve: `const kind = runKindFor(conditions?.experiment_type)`; `useQuery({ queryKey: kind && base ? kind.writes.runQueryKey(base) : ['run-context', null], queryFn: () => kind!.fetch(base!), enabled: Boolean(kind && base), retry: false })`. While that query is loading render `<PageSpinner />`; when it has data and `data.segments.some((s) => s.experiment_id === experiment.experiment_id)` return `<Navigate replace to={experimentHomePath(type, experiment.experiment_id, base, searchParams.get('tab') ?? undefined)} />`; otherwise render the page. The conditions query must also have settled (success or error) before deciding, so a serum page does not wait on anything new.
  - `IcpSection`: `<Collapsible … defaultOpen>`; update its doc comment (it no longer "opens collapsed").
  - `ResultsTab`: the core flood branch of the action bar and its explanatory paragraph (`:140-165`) stay — they are now the fallback shown only when a core flood's run cannot load.
- [ ] **Step 4: Run `npx vitest run src/pages/ExperimentDetail src/components/experiments`; expect PASS.** Any existing detail-page test that mounts an HPHT or Core Flood experiment must mock its run endpoint to reject (so the page renders) or be moved to the run-page suites; list each one touched in the commit body.
- [ ] **Step 5: Commit** — `[feat] Redirect run segments to the run page`

---

### Task 8: Experiments list and reactor modal

**Files:**
- Modify: `frontend/src/pages/ExperimentList.tsx`, `frontend/src/pages/ReactorGrid.tsx:484-498`
- Test: `frontend/src/pages/__tests__/ExperimentList.test.tsx`, `frontend/src/pages/__tests__/ReactorGrid.test.tsx`

**Interfaces:**
- Consumes: `experimentHomePath` (Task 1).

- [ ] **Step 1: Write the failing tests**

```tsx
// ExperimentList.test.tsx
it('the group flag expands the replicates; no replicates button remains', async () => {
  renderList([GROUP_ROW])                                   // SERUM_001, replicate_letters a, b, c
  const flag = await screen.findByRole('button', { name: 'Show replicates of SERUM_001' })
  expect(flag).toHaveTextContent(/group · 3/i)
  expect(flag).toHaveAttribute('title', '3 replicates: a, b, c')
  expect(flag).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/replicates:/)).not.toBeInTheDocument()
  await user.click(flag)
  expect(flag).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('SERUM_001a')).toBeInTheDocument()
  expect(screen.queryByTestId('group-route')).not.toBeInTheDocument()   // the flag click did not navigate
})
it('a letterless vial set shows a plain flag with the vial count (Review Focus 5)', async () => {
  renderList([VIAL_SET_ROW])                                // SERUM_pH_002, vial_count 4, no replicates
  expect(await screen.findByText(/group · 4 vials/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /show replicates/i })).not.toBeInTheDocument()
})
it('the description wraps to two lines and carries the full text as its title', async () => {
  renderList([{ ...PLAIN_ROW, description: LONG }])
  const cell = (await screen.findByText(LONG)).closest('td')!
  expect(cell).toHaveAttribute('title', LONG)
  expect(cell.className).toContain('line-clamp-2')
  expect(cell.className).not.toContain('truncate')
})
it('an HPHT row opens its run with the segment selected, and the reactor is not a second link', async () => {
  renderList([{ ...PLAIN_ROW, experiment_id: 'HPHT_297-2', base_experiment_id: 'HPHT_297',
                experiment_type: 'HPHT', reactor_number: 9, reactor_slot: 'R09' }])
  expect(screen.queryByRole('link', { name: 'R09' })).not.toBeInTheDocument()
  await user.click(await screen.findByText('HPHT_297-2'))
  expect(await screen.findByTestId('hpht-route')).toHaveTextContent('?segment=HPHT_297-2')   // probe prints location.search
})

// ReactorGrid.test.tsx
it('an occupied HPHT card offers one way in', async () => {
  await openModal(HPHT_CARD)                                // experiment_id HPHT_297-2, base HPHT_297
  expect(screen.getByRole('button', { name: 'Open HPHT_297-2' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /open run page|open segment/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run both files; expect FAIL.**
- [ ] **Step 3: Implement.**
  - Description `Td`: classes `text-xs text-ink-secondary min-w-[20rem] max-w-[36rem] whitespace-normal line-clamp-2`, `title={exp.description ?? undefined}`. Additives `Td` keeps `max-w-48 truncate` and gains `title={exp.additives_summary ?? undefined}`.
  - Remove the `groupBadge` prop and both of its branches. `ExperimentRow` takes `expanded?: boolean` and `onToggle?: () => void` instead. In the ID cell: letter group → `<button aria-label={`Show replicates of ${displayId}`} aria-expanded={expanded} title={`${n} replicates: ${letters.join(', ')}`}>` styled as the `Badge` (same classes plus `cursor-pointer hover:text-ink-primary`), text `group · {n}` followed by `▸`/`▾`, `onClick` stops propagation and calls `onToggle`; vial set → `<Badge className="ml-2">group · {vialCount} vials</Badge>`. `n` and `letters` use `replicate_letters ?? replicates.map(replicate_label)` as today.
  - `target` for a non-group row: `experimentHomePath(exp.experiment_type, exp.experiment_id, exp.base_experiment_id)`. Delete `runPath` and render the Reactor cell as plain text.
  - `ReactorGrid.tsx:484-498`: one primary button `Open {card.experiment_id}` navigating to `experimentHomePath(card.experiment_type, card.experiment_id, card.base_experiment_id)` (use the fields the card payload already carries; `runPath` at `:32-35` is built from the same two). Remove the second button.
- [ ] **Step 4: Update existing cases:** `renders the group summary` and `issue #98` (`'3 replicates: a, b, c'` / `'2 replicates: a, b'` text → the flag's `title`), both `expand replicates` clicks (new accessible name), the `N vials` case (new text), the #159 reactor-link case (now asserts the row target), and the ReactorGrid `Open run page` cases.
- [ ] **Step 5: Run `npx vitest run src/pages/__tests__`; expect PASS.**
- [ ] **Step 6: Commit** — `[feat] Widen list description, clickable group flag`

---

### Task 9: Full gate, browser check, docs

**Files:**
- Modify: `docs/user_guide/USER_MANUAL.md` (the sections describing the experiment detail page, the HPHT and Core Flood run pages, and the Experiments list), `docs/working/issue-log.md` (append an entry in the file's existing format)

- [ ] **Step 1: Run the full gate.** `cd frontend && npm test && npm run lint && npm run type-check`. Expected: all exit 0; vitest count is the pre-branch count (745 at `feat/reactor-labels`; record the actual `develop` number first) plus the new cases minus the three removed in Task 3.
- [ ] **Step 2: Check in the browser** on `http://localhost:5173` (Chrome DevTools; full-page screenshots time out on chart pages, so read the DOM with `evaluate_script`). Each line is a spec acceptance criterion:
  - `/experiments/HPHT_297-2?tab=notes` → URL becomes `/hpht/HPHT_297?segment=HPHT_297-2&tab=notes`; Back leaves the page in one press.
  - `/hpht/HPHT_304` → no `nav[aria-label="Segments"]`, no Segments section, `h1` is `HPHT_304`, rename / status / description / date / sample / background / delete present.
  - `/hpht/HPHT_297?segment=HPHT_297-2` → 8 sample rows, the `HPHT_297-2` rows carry `data-marked`; the toggle narrows and restores; Conditions, Notes, XRD and Entry Logs change when `HPHT_297` is picked.
  - `/core-floods/CF_027` → H₂ over time shows two charts; ICP over time is open.
  - `/experiments` → an HPHT row and its ID lead to the run page; the Reactor cell is text; Description shows two lines; the group flag on `SERUM_Buffer_015` expands a, b, c.
  - A serum experiment opens on Results.
  - `list_console_messages`: no new errors or 404s.
- [ ] **Step 3: Update the docs.** In `USER_MANUAL.md` replace the description of the separate segment page for HPHT and Core Flood with the one-page model (picker, marked rows, tabs), note that old `/experiments/{id}` links still work, and describe the group flag. Edit with the Edit tool so the `docs/project_context/` sync hook runs. Append the issue-log entry (files changed, tests added, the two decisions from the spec header).
- [ ] **Step 4: Commit** — `[chore] Document the one-page run model`
