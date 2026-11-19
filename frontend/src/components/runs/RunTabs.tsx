import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { experimentsApi } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import { PageSpinner } from '@/components/ui'
import { ConditionsTab } from '@/pages/ExperimentDetail/ConditionsTab'
import { NotesTab } from '@/pages/ExperimentDetail/NotesTab'
import { AnalysisTab } from '@/pages/ExperimentDetail/AnalysisTab'
import { ModificationsTab } from '@/pages/ExperimentDetail/ModificationsTab'
import { RUN_TABS, RUN_TAB_LABEL, runViewSearch, type RunView } from './runView'

/** The run page's tab bar and content. Results is the run-level node the page
 *  passes in; the other tabs belong to the selected segment. */
export function RunTabs({ view, results }: { view: RunView; results: ReactNode }) {
  const [params] = useSearchParams()
  const id = view.segmentId

  // Always enabled so the Notes and Entry Logs counts show on every tab.
  const { data: experiment, isError: experimentFailed } = useQuery({
    queryKey: ['experiment', id],
    queryFn: () => experimentsApi.get(id),
  })
  // A segment without conditions answers 404 (an error): that still settles the tab.
  const { data: conditions, isPending: conditionsPending } = useQuery({
    queryKey: ['conditions', id],
    queryFn: () => conditionsApi.getByExperiment(id),
    retry: false,
  })

  const count = (tab: string): number =>
    tab === 'notes' ? experiment?.notes.length ?? 0
      : tab === 'logs' ? experiment?.modifications.length ?? 0
        : 0

  return (
    <div className="space-y-4">
      <div className="border-b border-surface-border flex gap-0">
        {RUN_TABS.map((tab) => {
          const active = view.tab === tab
          const n = count(tab)
          return (
            <Link
              key={tab}
              to={runViewSearch(params, { tab })}
              replace
              aria-current={active ? 'page' : undefined}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                active
                  ? 'border-brand-red text-ink-primary'
                  : 'border-transparent text-ink-muted hover:text-ink-secondary'
              }`}
            >
              {RUN_TAB_LABEL[tab]}
              {n > 0 && (
                <span className="ml-1.5 text-[10px] bg-surface-raised rounded px-1">{n}</span>
              )}
            </Link>
          )
        })}
      </div>

      {view.tab === 'results' ? results : (
        <>
          <p className="text-xs text-ink-muted">
            {RUN_TAB_LABEL[view.tab]} of {id}
          </p>
          <div className="bg-surface-card border border-surface-border rounded-lg overflow-hidden">
            {experimentFailed && !experiment ? (
              <p className="text-sm text-red-400 p-4">Could not load {id}.</p>
            ) : !experiment ? <PageSpinner /> : (
              <>
                {view.tab === 'conditions' && (conditionsPending ? <PageSpinner /> : (
                  // key: an open edit form must never survive a change of segment.
                  <ConditionsTab key={id} conditions={conditions ?? null} experimentId={id} experimentFk={experiment.id} />
                ))}
                {view.tab === 'notes' && (
                  // key: a draft must never survive a change of segment.
                  <NotesTab key={id} experimentId={id} notes={experiment.notes} />
                )}
                {view.tab === 'logs' && <ModificationsTab modifications={experiment.modifications} />}
                {view.tab === 'xrd' && <AnalysisTab key={id} experimentId={id} />}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
