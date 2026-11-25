import { useParams, Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { experimentsApi } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import { PageSpinner } from '@/components/ui'
import { experimentHomePath } from '@/utils/experimentId'
import { ExperimentBreadcrumb, GroupStrip } from '@/components/experiments/RunContextHeader'
import { ExperimentRecordHeader } from '@/components/experiments/ExperimentRecordHeader'
import { isInReplicateSet, runKindFor } from '@/components/experiments/runContext'
import { MainSection, PANEL, TAB_BAR, TabContent, useTabScroll } from '@/components/runs/MainSection'
import { RUN_TABS, RUN_TAB_LABEL, parseTab, showsMain, type RunTab } from '@/components/runs/runView'
import { ConditionsTab } from './ConditionsTab'
import { ResultsTab } from './ResultsTab'
import { NotesTab } from './NotesTab'
import { ModificationsTab } from './ModificationsTab'
import { AnalysisTab } from './AnalysisTab'

/** Experiment detail page. Main stacks the Results, Conditions and XRD sections
 *  (XRD renders AnalysisTab: XRD phases and external analyses, issue #143); their
 *  tabs scroll to them. Notes and Entry Logs are tabs of their own. */
export function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // The active tab lives in the URL so a link can open a tab (issue #162), with
  // the run pages' `?tab=` values. Switching replaces the history entry, so Back
  // leaves the page instead of stepping through tabs.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseTab(searchParams.get('tab'))
  const setActiveTab = (tab: RunTab) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'main') next.delete('tab')
        else next.set('tab', tab)
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
  const loading = isLoading || conditionsLoading || runLoading || (runFetching && !inRun)
  useTabScroll(activeTab, !loading)

  if (loading) return <PageSpinner />
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
      <div {...TAB_BAR}>
        {RUN_TABS.map((tab) => (
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
            {RUN_TAB_LABEL[tab]}
            {tab === 'notes' && experiment.notes.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-surface-raised rounded px-1">
                {experiment.notes.length}
              </span>
            )}
            {tab === 'logs' && experiment.modifications.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-surface-raised rounded px-1">
                {experiment.modifications.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {showsMain(activeTab) ? (
        <TabContent className="space-y-6">
          <MainSection tab="results" heading="Results">
            <div className={PANEL}>
              <ResultsTab
                experimentId={id!}
                experimentFk={experiment.id}
                idTimepointDays={experiment.id_timepoint_days}
                experimentType={conditions?.experiment_type ?? null}
                experimentStart={experiment.date}
                baseExperimentId={experiment.base_experiment_id}
              />
            </div>
          </MainSection>
          <MainSection tab="conditions" heading="Conditions">
            <div className={PANEL}>
              <ConditionsTab conditions={conditions ?? null} experimentId={id!} experimentFk={experiment.id} />
            </div>
          </MainSection>
          <MainSection tab="xrd" heading="XRD">
            <div className={PANEL}>
              <AnalysisTab experimentId={id!} />
            </div>
          </MainSection>
        </TabContent>
      ) : (
        <TabContent className={PANEL}>
          {activeTab === 'notes' ? (
            // key={id}: a draft must never survive navigation to another experiment.
            <NotesTab key={id} experimentId={id!} notes={experiment.notes} />
          ) : (
            <ModificationsTab modifications={experiment.modifications} />
          )}
        </TabContent>
      )}
    </div>
  )
}
