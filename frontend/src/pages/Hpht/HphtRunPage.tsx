import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hphtApi, type HphtRun, type HphtSample, type HphtWarning } from '@/api/hpht'
import { Badge, Breadcrumb, Button, Card, CardHeader, PageSpinner } from '@/components/ui'
import { ExportAllButton } from '@/components/experiments/ExportAllButton'
import { IcpChart } from '@/components/icp/IcpChart'
import { segmentStarts } from '@/components/icp/icpSeries'
import { Collapsible } from '@/components/runs/Collapsible'
import { RunNotFound, SegmentIdList, useCanonicalRunUrl } from '@/components/runs/runPageNav'
import { RunTabs } from '@/components/runs/RunTabs'
import { SegmentPicker } from '@/components/runs/SegmentPicker'
import { runViewSearch, sampleMarks } from '@/components/runs/runView'
import { RunTitle, useRunRecord } from '@/components/runs/useRunRecord'
import { SegmentStatusSelect } from '@/components/runs/SegmentStatusSelect'
import { latestSegment, ongoingIds, rootSegments, runDescription } from '@/components/runs/runSegments'
import { SegmentsTable } from '@/pages/CoreFloods/SegmentsTable'
import { ConditionsSummaryCard } from './ConditionsSummaryCard'
import { H2Charts } from '@/components/runs/H2Charts'
import { HphtSampleModal } from './HphtSampleModal'
import { RunSamplesTable } from '@/components/results/RunSamplesTable'
import { scalarDetails } from '@/components/results/ScalarExtras'
import { fromHpht } from '@/components/results/sampleRows'
import { HPHT_WRITES, invalidateHphtWrites } from './hphtWrites'

interface ApiError extends Error {
  response?: { status?: number }
}

const HEADING = 'text-xs font-semibold text-ink-secondary uppercase tracking-wider'
const MONO = 'font-mono-data text-ink-primary'

function WarningLine({ run, warning }: { run: HphtRun; warning: HphtWarning }) {
  const qc = useQueryClient()
  const ids = warning.experiment_ids
  const joined = ids.join(', ')
  // The Segments section exists only on a multi-segment run; a single segment is
  // edited in the record header at the top of the page.
  const multi = run.segments.length > 1
  switch (warning.code) {
    case 'multiple_roots':
      return <p>Several segments have no parent: <span className={MONO}>{joined}</span>. Rename the extra roots into this run&apos;s sequence (Segments).</p>
    case 'missing_description':
      return (
        <p>
          No description on <span className={MONO}>{joined}</span>.{' '}
          {multi ? 'Add one in Segments.' : 'Add one under the ID above.'}
        </p>
      )
    case 'base_mismatch':
      return (
        <p>
          <span className={MONO}>{joined}</span> {ids.length === 1 ? 'does' : 'do'} not follow the run&apos;s
          base ID <span className={MONO}>{run.base_id}</span> (expected <span className={MONO}>{run.base_id}-2</span>,{' '}
          <span className={MONO}>{run.base_id}_Text</span>, …).{' '}
          {multi ? 'Rename in Segments.' : 'Rename it with the pencil beside the ID above.'}
        </p>
      )
    case 'multiple_ongoing':
      return (
        <div className="space-y-2">
          <p>More than one segment is ONGOING: <span className={MONO}>{joined}</span>.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ids.map((id) => {
              const seg = run.segments.find((s) => s.experiment_id === id)
              return seg ? (
                <div key={id} className="flex items-center gap-2">
                  <span className={`${MONO} text-xs`}>{id}</span>
                  <SegmentStatusSelect
                    segment={seg}
                    onChanged={() => invalidateHphtWrites(qc, run.base_id, [id])}
                  />
                </div>
              ) : null
            })}
          </div>
        </div>
      )
  }
}

/** One HPHT run (issue #150): conditions, sample timeline, cumulative charts and inline entry. */
export function HphtRunPage() {
  const { baseId = '' } = useParams<{ baseId: string }>()
  const [params] = useSearchParams()
  const [modal, setModal] = useState<{ editing?: HphtSample } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [describing, setDescribing] = useState<string | null>(null)

  const { data: run, isLoading, error } = useQuery({
    queryKey: HPHT_WRITES.runQueryKey(baseId),
    queryFn: () => hphtApi.get(baseId),
  })
  useCanonicalRunUrl(baseId, run, HPHT_WRITES)

  const { view, recordHeader } = useRunRecord({ run, params, writes: HPHT_WRITES, type: 'HPHT' })

  // An ICP failure only hides the expanders and chart; it never breaks the run page.
  const { data: icpRows } = useQuery({
    queryKey: ['hpht-icp', baseId],
    queryFn: () => hphtApi.icp(baseId),
  })
  const icpByResult = useMemo(
    () => new Map<number, Record<string, number>>((icpRows ?? []).map((r) => [r.result_id, r.elements])),
    [icpRows],
  )

  if (isLoading) return <PageSpinner />
  if (error) {
    if ((error as ApiError).response?.status === 404) {
      return <RunNotFound kind="HPHT" requestedId={baseId} writes={HPHT_WRITES} listLabel="HPHT" />
    }
    return (
      <p className="text-sm text-red-400 py-4">Failed to load HPHT run: {(error as Error).message}</p>
    )
  }
  if (!run) return null

  const main = run.samples.filter((s) => !s.is_variant)
  const side = run.samples.filter((s) => s.is_variant)
  const reactor = latestSegment(run.segments)?.reactor_slot
  const ongoing = ongoingIds(run.segments)
  const description = runDescription(run.segments)
  // The export covers the whole lineage from any segment; send the root's ID.
  const exportId = (rootSegments(run.segments)[0] ?? run.segments[0])?.experiment_id
  const onEdit = (s: HphtSample) => setModal({ editing: s })

  const multi = run.segments.length > 1
  const segmentHref = (id: string) => runViewSearch(params, { segmentId: id })
  const marks = sampleMarks(view, run.segments)

  const results = (
    <div className="space-y-4">
      <ConditionsSummaryCard
        conditions={run.conditions}
        conditionsHref={runViewSearch(params, { segmentId: run.conditions?.experiment_id, tab: 'conditions' })}
      />

      <section aria-labelledby="samples-heading">
        <Card padding="none">
          <CardHeader>
            <h2 id="samples-heading" className={HEADING}>Samples</h2>
          </CardHeader>
          <div className="p-4">
            {/* Issue #163: newest first (the server sends oldest first). */}
            <RunSamplesTable
              rows={[...(view?.only ? main.filter((s) => s.experiment_id === view.segmentId) : main)].reverse().map(fromHpht)}
              scope="run"
              kind="hpht"
              onEdit={onEdit}
              icpByResult={icpByResult}
              emptyText="No samples yet"
              segmentHref={segmentHref}
              markedExperimentId={marks.main}
              detailsExtra={scalarDetails}
            />
          </div>
        </Card>
      </section>

      <section aria-labelledby="charts-heading">
        <Card padding="none">
          <CardHeader>
            <h2 id="charts-heading" className={HEADING}>H₂ over time</h2>
          </CardHeader>
          <div className="p-4">
            <H2Charts samples={run.samples} />
          </div>
        </Card>
      </section>

      {icpRows && icpRows.length > 0 && (
        <Collapsible
          title="ICP over time"
          summary={`${icpRows.length} ${icpRows.length === 1 ? 'sample' : 'samples'}`}
        >
          <IcpChart rows={icpRows} markers={segmentStarts(run.samples)} />
        </Collapsible>
      )}

      {side.length > 0 && (
        <Collapsible
          // key: picking a side sample reopens the section on its marked row.
          key={marks.side ?? 'none'}
          title="Side samples"
          summary={`${side.length} (variants, raw values)`}
        >
          <RunSamplesTable
            rows={[...side].reverse().map(fromHpht)}
            scope="run"
            kind="hpht"
            variant
            onEdit={onEdit}
            icpByResult={icpByResult}
            segmentHref={segmentHref}
            markedExperimentId={marks.side}
            detailsExtra={scalarDetails}
          />
        </Collapsible>
      )}

      {multi && (
        <Collapsible
          title="Segments"
          summary={run.segments.length}
          links={<>(<SegmentIdList ids={run.segments.map((s) => s.experiment_id)} hrefFor={segmentHref} />)</>}
        >
          <SegmentsTable
            baseId={run.base_id}
            segments={run.segments}
            renaming={renaming}
            setRenaming={setRenaming}
            describing={describing}
            setDescribing={setDescribing}
            writes={HPHT_WRITES}
          />
        </Collapsible>
      )}

      {run.warnings.length > 0 && (
        <Collapsible title="Data checks" summary={run.warnings.length}>
          <ul className="space-y-3 text-sm text-ink-secondary">
            {run.warnings.map((w) => (
              <li key={w.code} data-testid={`warning-${w.code}`}>
                <WarningLine run={run} warning={w} />
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Breadcrumb items={[{ label: 'HPHT', to: '/hpht' }, { label: run.base_id, mono: true }]} />
          <RunTitle run={run} description={description} recordHeader={recordHeader} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>Reactor {reactor ?? '—'}</span>
            {ongoing.length > 0 && (
              <Badge variant="ongoing">
                Ongoing: <SegmentIdList ids={ongoing} inherit hrefFor={segmentHref} />
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exportId && <ExportAllButton experimentId={exportId} />}
          <Button variant="primary" size="sm" onClick={() => setModal({})}>
            + Add sample
          </Button>
        </div>
      </div>

      {view && multi && <SegmentPicker segments={run.segments} view={view} />}
      {multi && recordHeader}

      {view ? <RunTabs view={view} results={results} /> : results}

      <HphtSampleModal
        open={modal !== null}
        onClose={() => setModal(null)}
        run={run}
        editing={modal?.editing}
      />
    </div>
  )
}
