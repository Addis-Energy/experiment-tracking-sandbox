import { describe, it, expect } from 'vitest'
import type { RunSegment } from '@/api/runs'
import { defaultSegment, runViewFrom, runViewSearch } from '../runView'

let nextId = 1
function seg(experimentId: string, over: Partial<RunSegment> = {}): RunSegment {
  return {
    id: nextId++,
    experiment_id: experimentId,
    status: 'COMPLETED',
    date: null,
    parent_experiment_id: null,
    is_variant: false,
    description: null,
    conditions_id: null,
    pore_volume_mL: null,
    rock_mass_g: null,
    reactor_slot: null,
    ...over,
  }
}

const two = [
  seg('HPHT_297', { status: 'COMPLETED', date: '2026-09-01' }),
  seg('HPHT_297-2', { status: 'COMPLETED', date: '2026-10-09' }),
]

describe('runView', () => {
  it('defaults to the latest segment, results tab, not explicit', () => {
    expect(runViewFrom(new URLSearchParams(''), two)).toEqual({
      tab: 'results', segmentId: 'HPHT_297-2', explicit: false, only: false,
    })
  })
  it('prefers the first ONGOING non-variant segment as the default', () => {
    const segs = [
      seg('A', { status: 'ONGOING', date: '2026-01-01' }),
      seg('A-2', { status: 'QUEUED', date: '2026-02-01' }),
      seg('A_Blank', { status: 'ONGOING', is_variant: true }),
    ]
    expect(defaultSegment(segs)?.experiment_id).toBe('A')
  })
  it('reads segment, only and tab', () => {
    expect(runViewFrom(new URLSearchParams('segment=HPHT_297&only=1&tab=NOTES'), two)).toEqual({
      tab: 'notes', segmentId: 'HPHT_297', explicit: true, only: true,
    })
  })
  it('falls back when the segment is not in the run', () => {
    expect(runViewFrom(new URLSearchParams('segment=HPHT_999&only=1&tab=bogus'), two)).toEqual({
      tab: 'results', segmentId: 'HPHT_297-2', explicit: false, only: false,
    })
  })
  it('ignores only on a single-segment run', () => {
    expect(runViewFrom(new URLSearchParams('segment=HPHT_304&only=1'), [seg('HPHT_304')])!.only).toBe(false)
  })
  it('returns null for a run with no segments', () => {
    expect(runViewFrom(new URLSearchParams(''), [])).toBeNull()
  })
  it('builds search strings, keeping unrelated params', () => {
    const cur = new URLSearchParams('segment=HPHT_297&only=1&tab=notes')
    expect(runViewSearch(cur, { tab: 'results' })).toBe('?segment=HPHT_297&only=1')
    expect(runViewSearch(cur, { segmentId: 'HPHT_297-2' })).toBe('?segment=HPHT_297-2&only=1&tab=notes')
    expect(runViewSearch(cur, { segmentId: null })).toBe('?tab=notes')
    expect(runViewSearch(cur, { only: false })).toBe('?segment=HPHT_297&tab=notes')
    expect(runViewSearch(new URLSearchParams(''), { tab: 'results' })).toBe('')
    expect(runViewSearch(new URLSearchParams('x=1&tab=notes'), { segmentId: 'A' })).toBe('?segment=A&tab=notes&x=1')
  })
})
