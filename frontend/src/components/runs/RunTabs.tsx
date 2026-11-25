import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { experimentsApi, type ExperimentDetail } from '@/api/experiments'
import { conditionsApi } from '@/api/conditions'
import { PageSpinner } from '@/components/ui'
import { ConditionsTab } from '@/pages/ExperimentDetail/ConditionsTab'
import { NotesTab } from '@/pages/ExperimentDetail/NotesTab'
import { AnalysisTab } from '@/pages/ExperimentDetail/AnalysisTab'
import { ModificationsTab } from '@/pages/ExperimentDetail/ModificationsTab'
import { MainSection, PANEL, TAB_BAR, TabContent, useTabScroll } from './MainSection'
import { RUN_TABS, RUN_TAB_LABEL, runViewSearch, showsMain, type RunView } from './runView'

/** The run page's tab bar and content. Main stacks the run-level results node the
 *  page passes in with the selected segment's conditions and XRD; the Results,
 *  Conditions and XRD tabs scroll to their section of it. Notes and Entry Logs are
 *  the selected segment's, each a view of its own. */
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

  // Wait for the conditions: they sit above XRD, so loading them moves it.
  useTabScroll(view.tab, (Boolean(experiment) || experimentFailed) && !conditionsPending)

  const count = (tab: string): number =>
    tab === 'notes' ? experiment?.notes.length ?? 0
      : tab === 'logs' ? experiment?.modifications.length ?? 0
        : 0

  /** A card for part of the selected segment's record, once the segment has loaded. */
  const record = (render: (segment: ExperimentDetail) => ReactNode) => (
    <div className={PANEL}>
      {experimentFailed && !experiment ? (
        <p className="text-sm text-red-400 p-4">Could not load {id}.</p>
      ) : !experiment ? <PageSpinner /> : render(experiment)}
    </div>
  )

  return (
    <div className="space-y-4">
      <div {...TAB_BAR}>
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

      {showsMain(view.tab) ? (
        <TabContent className="space-y-6">
          <MainSection tab="results">{results}</MainSection>
          <MainSection tab="conditions" heading={`Conditions of ${id}`}>
            {record((segment) => (conditionsPending ? <PageSpinner /> : (
              // key: an open edit form must never survive a change of segment.
              <ConditionsTab key={id} conditions={conditions ?? null} experimentId={id} experimentFk={segment.id} />
            )))}
          </MainSection>
          <MainSection tab="xrd" heading={`XRD of ${id}`}>
            {record(() => <AnalysisTab key={id} experimentId={id} />)}
          </MainSection>
        </TabContent>
      ) : (
        <TabContent className="space-y-4">
          <p className="text-xs text-ink-muted">
            {RUN_TAB_LABEL[view.tab]} of {id}
          </p>
          {record((segment) => (view.tab === 'notes' ? (
            // key: a draft must never survive a change of segment.
            <NotesTab key={id} experimentId={id} notes={segment.notes} />
          ) : (
            <ModificationsTab modifications={segment.modifications} />
          )))}
        </TabContent>
      )}
    </div>
  )
}
