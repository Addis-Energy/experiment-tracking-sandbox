import type { RunSegment } from '@/api/runs'
import { latestSegment } from './runSegments'

export const RUN_TABS = ['results', 'conditions', 'notes', 'xrd', 'logs'] as const
export type RunTab = typeof RUN_TABS[number]

export const RUN_TAB_LABEL: Record<RunTab, string> = {
  results: 'Results',
  conditions: 'Conditions',
  notes: 'Notes',
  xrd: 'XRD',
  logs: 'Entry Logs',
}

export interface RunView {
  tab: RunTab
  /** Always a segment of the run. */
  segmentId: string
  /** True when the URL named this segment; false when it is the default. */
  explicit: boolean
  /** Samples table narrowed to the segment. Only true when `explicit`, the run has >1 segment,
   *  and the segment is not a side sample (a variant's rows are not in the main table). */
  only: boolean
}

const DEFAULT_TAB: RunTab = 'results'

/** The first non-variant ONGOING segment in run order, else the latest segment. */
export function defaultSegment(segments: RunSegment[]): RunSegment | undefined {
  return (
    segments.find((s) => !s.is_variant && s.status?.toUpperCase() === 'ONGOING') ??
    latestSegment(segments)
  )
}

function parseTab(raw: string | null): RunTab {
  const t = raw?.toLowerCase()
  return RUN_TABS.find((x) => x === t) ?? DEFAULT_TAB
}

/** The run page's view state from the URL; null when the run has no segments. */
export function runViewFrom(params: URLSearchParams, segments: RunSegment[]): RunView | null {
  const fallback = defaultSegment(segments)
  if (!fallback) return null
  const named = params.get('segment')
  const match = named ? segments.find((s) => s.experiment_id === named) : undefined
  const explicit = match !== undefined
  return {
    tab: parseTab(params.get('tab')),
    segmentId: (match ?? fallback).experiment_id,
    explicit,
    only: explicit && segments.length > 1 && !match?.is_variant && params.get('only') === '1',
  }
}

/** True when the view's selected segment is a side sample (variant). */
export function isVariantSelected(view: RunView, segments: RunSegment[]): boolean {
  return segments.some((s) => s.experiment_id === view.segmentId && s.is_variant)
}

/** Which samples table marks the selected segment's rows. A side sample (variant)
 *  is marked in Side samples, which then opens; any other segment in the main table.
 *  Nothing is marked for Whole run or on a single-segment run. */
export function sampleMarks(
  view: RunView | null,
  segments: RunSegment[],
): { main?: string; side?: string } {
  if (!view?.explicit || segments.length <= 1) return {}
  return isVariantSelected(view, segments) ? { side: view.segmentId } : { main: view.segmentId }
}

/** Search string (with leading '?', or '' when empty) for a change to the view.
 *  `segmentId: null` clears segment and only. Other params are kept, after the view's own. */
export function runViewSearch(
  current: URLSearchParams,
  change: { tab?: RunTab; segmentId?: string | null; only?: boolean },
): string {
  const segment = change.segmentId === undefined ? current.get('segment') : change.segmentId
  const only = change.segmentId === null ? false : change.only ?? current.get('only') === '1'
  const tab = change.tab ?? current.get('tab')

  const next = new URLSearchParams()
  if (segment) next.set('segment', segment)
  if (segment && only) next.set('only', '1')
  if (tab && tab !== DEFAULT_TAB) next.set('tab', tab)
  current.forEach((value, key) => {
    if (key !== 'segment' && key !== 'only' && key !== 'tab') next.append(key, value)
  })
  const query = next.toString()
  return query ? `?${query}` : ''
}
