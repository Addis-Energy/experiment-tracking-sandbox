import { useParams, Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { experimentsApi } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import { PageSpinner } from '@/components/ui'
import { experimentHomePath } from '@/utils/experimentId'
import { ExperimentBreadcrumb, GroupStrip } from '@/components/experiments/RunContextHeader'
import { ExperimentRecordHeader } from '@/components/experiments/ExperimentRecordHeader'
import { isInReplicateSet, runKindFor } from '@/components/experiments/runContext'
import { ConditionsTab } from './ConditionsTab'
import { ResultsTab } from './ResultsTab'
import { NotesTab } from './NotesTab'
import { ModificationsTab } from './ModificationsTab'
import { AnalysisTab } from './AnalysisTab'

// 'XRD' renders AnalysisTab (XRD phases and external analyses); relabelled in issue #143.
const TABS = ['Results', 'Conditions', 'Notes', 'XRD', 'Entry Logs'] as const
type Tab = typeof TABS[number]

/** `?tab=` values (issue #162). Links use these, e.g. SegmentLink's `tab`. */
const TAB_PARAM: Record<Tab, string> = {
  Conditions: 'conditions',
  Results: 'results',
  Notes: 'notes',
  XRD: 'xrd',
  'Entry Logs': 'logs',
}

/** The tab named by `?tab=` (case-insensitive); Results when absent or unknown. */
function tabFromParam(value: string | null): Tab {
  const wanted = value?.toLowerCase()
  return TABS.find((t) => TAB_PARAM[t] === wanted) ?? 'Results'
}

/** Full experiment detail page with tabbed navigation (Results, Conditions, XRD, Notes, Modifications). */
export function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // The active tab lives in the URL so a link can open a tab (issue #162).
  // Switching replaces the history entry, so Back leaves the page instead of
  // stepping through tabs.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = tabFromParam(searchParams.get('tab'))
  const setActiveTab = (tab: Tab) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', TAB_PARAM[tab])
        return next
      },
      { replace: true },
    )

  const { data: experiment, isLoading, error } = useQuery({
    queryKey: ['experiment', id],
    queryFn: () => experimentsApi.get(id!),
    enabled: Boolean(id),
  })

  const { data: conditions, isLoading: conditionsLoading } = useQuery({
    queryKey: ['conditions', id],
    queryFn: () => conditionsApi.getByExperiment(id!),
    enabled: Boolean(id),
    retry: false,
  })

  const { data: replicateGroup } = useQuery({
    queryKey: ['replicate-group', id],
    queryFn: () => experimentsApi.getReplicateGroup(id!),
    enabled: Boolean(id),
  })

  // Issue #101: `replicateGroup` is letter-only, so a letterless '-t<days>' vial
  // looked like a standalone experiment and got no Group link — leaving the
  // stem's other vials reachable only by typing their raw IDs. The group
  // endpoint counts vials too. Shares its key with ResultsTab/GroupedResultsView.
  const groupBaseId = replicateGroup?.base_experiment_id ?? experiment?.base_experiment_id ?? id
  const { data: groupDetail } = useQuery({
    queryKey: ['replicate-group-detail', groupBaseId],
    queryFn: () => experimentsApi.getGroup(groupBaseId!),
    enabled: Boolean(groupBaseId),
    // A 404 is a legitimate answer here — a sequential re-run whose stem row was
    // never created (SERUM_001-2 with no SERUM_001) has no group. Don't retry it.
    retry: false,
  })

  // A run segment lives on its run page. The run uses the run page's own key and
  // fetch, so the redirect target renders from cache. A failed run falls back to
  // this page.
  const runKind = runKindFor(conditions?.experiment_type)
  const runBaseId = experiment?.base_experiment_id ?? null
  const { data: run, isLoading: runLoading, isFetching: runFetching } = useQuery({
    queryKey: runKind && runBaseId ? runKind.writes.runQueryKey(runBaseId) : ['run-context', null],
    queryFn: () => runKind!.fetch(runBaseId!),
    enabled: Boolean(runKind && runBaseId),
    retry: false,
    // A cached run can predate this experiment (a segment just created): always
    // ask again on arrival rather than trust the cache's "not in this run". Stale
    // at once, not refetchOnMount: the query is enabled only after the experiment
    // and conditions load, and a query enabled late fetches only when stale.
    staleTime: 0,
  })
  const inRun = Boolean(experiment && run?.segments.some((s) => s.experiment_id === experiment.experiment_id))

  // Hold the spinner until a fetch made after mount has settled, unless the cached
  // run already contains the experiment (then the redirect needs no refetch).
  if (isLoading || conditionsLoading || runLoading || (runFetching && !inRun)) return <PageSpinner />
  if (error || !experiment) {
    return (
      <div className="space-y-2 p-6">
        <p className="text-red-400 text-sm">Experiment not found</p>
        {/* Issue #159: a way out of the dead end. */}
        <Link to="/experiments" className="text-sm text-red-400 hover:text-red-300">
          Back to Experiments
        </Link>
      </div>
    )
  }

  if (inRun) {
    return (
      <Navigate
        replace
        to={experimentHomePath(
          conditions?.experiment_type,
          experiment.experiment_id,
          runBaseId,
          searchParams.get('tab') ?? undefined,
        )}
      />
    )
  }

  const experimentType = conditions?.experiment_type
  const inReplicateSet = isInReplicateSet(
    experiment.replicate_label,
    replicateGroup?.members.length,
    groupDetail?.member_count,
  )

  return (
    <div className="space-y-4">
      {/* Breadcrumb, ID row, group strip (issue #156) */}
      <div>
        <ExperimentBreadcrumb
          experiment={experiment}
          experimentType={experimentType}
          replicateGroup={replicateGroup}
          groupMemberCount={groupDetail?.member_count}
        />
        <ExperimentRecordHeader
          experiment={experiment}
          conditions={conditions}
          belowId={
            <GroupStrip
              experiment={experiment}
              replicateGroup={replicateGroup}
              groupMemberCount={groupDetail?.member_count}
            />
          }
          inReplicateSet={inReplicateSet}
          onRenamed={(updated) => navigate(`/experiments/${updated.experiment_id}`, { replace: true })}
          onDeleted={() => navigate('/experiments', { replace: true })}
        />
      </div>


      {/* Tab bar */}
      <div className="border-b border-surface-border flex gap-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-brand-red text-ink-primary'
                : 'border-transparent text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {tab}
            {tab === 'Notes' && experiment.notes.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-surface-raised rounded px-1">
                {experiment.notes.length}
              </span>
            )}
            {tab === 'Entry Logs' && experiment.modifications.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-surface-raised rounded px-1">
                {experiment.modifications.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
        {activeTab === 'Conditions' && (
          <ConditionsTab conditions={conditions ?? null} experimentId={id!} experimentFk={experiment.id} />
        )}
        {activeTab === 'Results' && (
          <ResultsTab
            experimentId={id!}
            experimentFk={experiment.id}
            idTimepointDays={experiment.id_timepoint_days}
            experimentType={conditions?.experiment_type ?? null}
            experimentStart={experiment.date}
            baseExperimentId={experiment.base_experiment_id}
          />
        )}
        {activeTab === 'Notes' && (
          // key={id}: a draft must never survive navigation to another experiment.
          <NotesTab key={id} experimentId={id!} notes={experiment.notes} />
        )}
        {activeTab === 'Entry Logs' && (
          <ModificationsTab modifications={experiment.modifications} />
        )}
        {activeTab === 'XRD' && <AnalysisTab experimentId={id!} />}
      </div>
    </div>
  )
}
