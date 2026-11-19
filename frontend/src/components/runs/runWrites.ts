import type { QueryClient } from '@tanstack/react-query'

/** What a shared run component needs to know about the page it sits on: how to
 *  refresh after a write, and where a run lives (route and query key). Core Flood
 *  and HPHT each supply one. */
export interface RunWrites {
  /** Refreshes the run list, the run, and each touched segment's queries. */
  invalidate: (qc: QueryClient, baseId: string, segmentIds: string[]) => Promise<void>
  /** Route of a run page. */
  runPath: (baseId: string) => string
  /** Route of the run list: where a run page goes when its run is gone (issue #158). */
  listPath: '/hpht' | '/core-floods'
  /** Query key of a run's detail query (removed when the run disappears). */
  runQueryKey: (baseId: string) => unknown[]
}

/** The parts of a cached run payload a segment delete trims. HPHT also carries the
 *  run's conditions summary, which goes with its segment. */
interface TrimmableRun {
  segments: { experiment_id: string }[]
  samples: { experiment_id: string }[]
  conditions?: { experiment_id: string } | null
}

/** Drops a deleted segment from the cached run: the segment, its samples, and the
 *  conditions summary when it belonged to it. Until the run refetch lands, the page
 *  then never selects the deleted segment, so it is never fetched into a 404. Used
 *  by every delete path of a segment that leaves the run with others (the record
 *  header and the Segments table). */
export function trimDeletedSegment(qc: QueryClient, writes: RunWrites, baseId: string, deletedId: string): void {
  qc.setQueryData<TrimmableRun>(writes.runQueryKey(baseId), (cached) => {
    if (!cached) return cached
    const trimmed = {
      ...cached,
      segments: cached.segments.filter((s) => s.experiment_id !== deletedId),
      samples: cached.samples.filter((s) => s.experiment_id !== deletedId),
    }
    return cached.conditions?.experiment_id === deletedId ? { ...trimmed, conditions: null } : trimmed
  })
}
