import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { conditionsApi } from '@/api/conditions'
import { experimentsApi, type ExperimentDetail } from '@/api/experiments'
import type { RunSegment } from '@/api/runs'
import { ExperimentRecordHeader } from '@/components/experiments/ExperimentRecordHeader'
import { experimentHomePath } from '@/utils/experimentId'
import { runViewFrom, type RunView } from './runView'
import { trimDeletedSegment, type RunWrites } from './runWrites'

/** What the record wiring reads and trims from a run payload. HPHT also carries
 *  the run's conditions summary, which goes with its segment. */
interface RunRecordRun {
  base_id: string
  segments: RunSegment[]
  samples: { experiment_id: string }[]
  conditions?: { experiment_id: string } | null
}

interface Options<R extends RunRecordRun> {
  run: R | undefined
  params: URLSearchParams
  writes: RunWrites
  /** The experiment type, for where a renamed segment lives. */
  type: 'HPHT' | 'Core Flood'
}

/** The selected segment's record header, with the rename and delete handling both
 *  run pages share. `recordHeader` is null until the run and the segment's record
 *  have loaded. RunTabs runs the same two queries (same keys), so each is one request. */
export function useRunRecord<R extends RunRecordRun>({ run, params, writes, type }: Options<R>): {
  view: RunView | null
  recordHeader: ReactNode
} {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const view = run ? runViewFrom(params, run.segments) : null
  const segmentId = view?.segmentId ?? ''
  const { data: experiment } = useQuery({
    queryKey: ['experiment', segmentId],
    queryFn: () => experimentsApi.get(segmentId),
    enabled: !!view,
  })
  const { data: conditions } = useQuery({
    queryKey: ['conditions', segmentId],
    queryFn: () => conditionsApi.getByExperiment(segmentId),
    retry: false,
    enabled: !!view,
  })
  if (!run || !view || !experiment) return { view, recordHeader: null }

  // Issue #158 rule, as SegmentsTable applies it: the run goes with its last segment.
  const onDeleted = (deletedId: string) => {
    if (run.segments.length > 1) {
      // Drop the segment from the cached run first, so until the refetch lands the
      // default segment is never the deleted one (it would be fetched into a 404).
      trimDeletedSegment(qc, writes, run.base_id, deletedId)
      navigate(writes.runPath(run.base_id), { replace: true })
      // No segment ID: the record header evicts the deleted experiment's own keys.
      void writes.invalidate(qc, run.base_id, [])
      return
    }
    navigate(writes.listPath, { replace: true })
    setTimeout(() => {
      qc.removeQueries({ queryKey: writes.runQueryKey(run.base_id) })
      void writes.invalidate(qc, run.base_id, [])
    }, 0)
  }
  const onRenamed = (updated: ExperimentDetail) => {
    const newBase = updated.base_experiment_id ?? updated.experiment_id
    navigate(experimentHomePath(type, updated.experiment_id, newBase), { replace: true })
    if (newBase !== run.base_id && run.segments.length === 1) {
      // The run's only segment left it, so the old run is gone: refetching 404s.
      void writes.invalidate(qc, newBase, [])
      qc.removeQueries({ queryKey: writes.runQueryKey(run.base_id) })
    }
    void writes.invalidate(qc, run.base_id, [segmentId])
  }

  return {
    view,
    recordHeader: (
      <div id="record-header">
        {/* key: an open rename, date or sample editor must never survive a change of segment. */}
        <ExperimentRecordHeader
          key={segmentId}
          experiment={experiment}
          conditions={conditions}
          headingLevel={run.segments.length > 1 ? 'h2' : 'h1'}
          embedded
          reactorAsText
          onRenamed={onRenamed}
          onDeleted={onDeleted}
        />
      </div>
    ),
  }
}

/** The run's title block: the run heading and description above a picker, or on a
 *  single-segment run the record header alone, as the page heading. */
export function RunTitle({ run, description, recordHeader }: {
  run: { base_id: string; segments: unknown[] }
  description: string | null | undefined
  recordHeader: ReactNode
}) {
  if (run.segments.length > 1 || !recordHeader) {
    return (
      <>
        <h1 className="text-lg font-semibold text-ink-primary font-mono-data">{run.base_id}</h1>
        {description && <p className="text-sm text-ink-secondary max-w-prose">{description}</p>}
      </>
    )
  }
  return <>{recordHeader}</>
}
