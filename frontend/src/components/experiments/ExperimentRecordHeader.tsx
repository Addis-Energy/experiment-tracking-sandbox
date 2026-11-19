import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { experimentsApi, type ExperimentDetail } from '@/api/experiments'
import type { ConditionsResponse } from '@/api/conditions'
import { Badge, Button, Input, useToast } from '@/components/ui'
import { SegmentStatusSelect } from '@/components/runs/SegmentStatusSelect'
import { invalidateStatusChange } from '@/components/experiments/runContext'
import { runPathFor } from '@/utils/experimentId'
import { SampleSelector } from '@/components/ui/SampleSelector'
import { useExperimentIdValidation } from '@/hooks/useExperimentIdValidation'
import { CreateReplicatesModal } from '@/components/experiments/CreateReplicatesModal'
import { DeleteExperimentModal } from '@/components/experiments/DeleteExperimentModal'
import { ExportAllButton } from '@/components/experiments/ExportAllButton'
import { DescriptionEditor } from '@/pages/ExperimentDetail/DescriptionEditor'

/**
 * Query-key prefixes whose second element is an experiment ID. All are EVICTED
 * (not invalidated) after a delete: the delete frees the experiment ID, so a new
 * experiment can claim it, and a surviving-but-stale entry would render the dead
 * experiment's data until the refetch lands.
 *
 * Not reachable this way: ['scalar', resultId] and ['icp', resultId] are keyed
 * by result ID, so they cannot be targeted from the experiment ID alone. They
 * are harmless — a reused experiment ID never gets the old result IDs back.
 *
 * Also not reachable: the group caches, keyed by the BASE ID (or `-t` stem),
 * not the deleted experiment's ID — see GROUP_QUERY_PREFIXES (issue #105).
 */
const PER_EXPERIMENT_QUERY_KEYS = [
  'experiment',
  'delete-impact',
  'conditions',
  'additives',
  'experiment-results',
  'experiment-icp',
  'xrd',
  'external-analysis',
  'replicate-group',
] as const

/**
 * Query-key prefixes refreshed (invalidated, every entry) after a delete, because
 * the deletion changes data shown for OTHER experiments: the group page and the
 * grouped Results view (['replicate-group-detail', baseId]), the group's H₂
 * background rollup (['group-h2-bkg-rollup', baseId]), the group rollup
 * (['group-rollup', baseId]), the letter-only group wrapper, and the series ICP
 * of surviving siblings (['experiment-icp', siblingId]). They are keyed by a base
 * ID or a sibling's ID, which the delete handler does not know, so the whole
 * prefix is refreshed; each holds a handful of entries and only the ones on
 * screen refetch. 'group-rollup' was already refreshed this way before issue
 * #105; 'replicate-group-detail', 'group-h2-bkg-rollup' and 'experiment-icp'
 * were not, so a deleted vial stayed on its group page until a reload.
 */
const GROUP_QUERY_PREFIXES = [
  'replicate-group',
  'replicate-group-detail',
  'group-rollup',
  'group-h2-bkg-rollup',
  'experiment-icp',
] as const

export interface ExperimentRecordHeaderProps {
  experiment: ExperimentDetail
  conditions: ConditionsResponse | null | undefined
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

/** The experiment record header: ID row (rename, status, badges), description,
 *  meta line (date, sample, reactor), and quick actions with their modals. */
export function ExperimentRecordHeader({
  experiment,
  conditions,
  belowId,
  inReplicateSet = false,
  headingLevel = 'h1',
  embedded = false,
  reactorAsText = false,
  onRenamed,
  onDeleted,
}: ExperimentRecordHeaderProps) {
  const id = experiment.experiment_id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { success, error: toastError } = useToast()
  const [editingId, setEditingId] = useState(false)
  const [idDraft, setIdDraft] = useState('')
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState('')
  const [editingSampleId, setEditingSampleId] = useState(false)
  const [sampleDraft, setSampleDraft] = useState('')
  const [replicatesOpen, setReplicatesOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const descriptionNote = experiment.notes.find((n) => n.note_type === 'description')

  const renameValidation = useExperimentIdValidation(idDraft, experiment.experiment_id)

  const renameMutation = useMutation({
    mutationFn: (newId: string) => experimentsApi.patch(id, { experiment_id: newId }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['experiment'] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      success('Experiment renamed')
      setEditingId(false)
      onRenamed(updated)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      if (detail?.includes('already exists')) {
        toastError('ID conflict', detail)
      } else {
        toastError('Rename failed', String(err))
      }
      setEditingId(false)
    },
  })

  const dateMutation = useMutation({
    mutationFn: (newDate: string) => experimentsApi.patch(id, { date: newDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment'] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      success('Start date updated')
      setEditingDate(false)
    },
    onError: () => {
      toastError('Update failed', 'Could not save start date')
      setEditingDate(false)
    },
  })

  const sampleMutation = useMutation({
    mutationFn: (newSampleId: string) =>
      experimentsApi.patch(id, { sample_id: newSampleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment'] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      success('Sample updated — calculations re-run')
      setEditingSampleId(false)
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      toastError('Sample change failed', detail ?? String(err))
      setEditingSampleId(false)
    },
  })

  const outlierMutation = useMutation({
    mutationFn: (isOutlier: boolean) => experimentsApi.patch(id, { is_outlier: isOutlier }),
    onSuccess: (_updated, isOutlier) => {
      queryClient.invalidateQueries({ queryKey: ['experiment'] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      queryClient.invalidateQueries({ queryKey: ['group-rollup'] })
      queryClient.invalidateQueries({ queryKey: ['replicate-group'] })
      success(isOutlier ? 'Marked as outlier — excluded from group stats' : 'Outlier flag removed')
    },
    onError: (err: unknown) => {
      toastError('Update failed', String(err))
    },
  })

  // Issue #152: a background / blank is left out of a group's averages when the
  // group also has sample vials, and is offered first as an H₂ background.
  const backgroundMutation = useMutation({
    mutationFn: (isBackground: boolean) => experimentsApi.patch(id, { is_background: isBackground }),
    onSuccess: (_updated, isBackground) => {
      queryClient.invalidateQueries({ queryKey: ['experiment'] })
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      queryClient.invalidateQueries({ queryKey: ['group-rollup'] })
      queryClient.invalidateQueries({ queryKey: ['replicate-group'] })
      success(isBackground ? 'Marked as background' : 'Background flag removed')
    },
    onError: (err: unknown) => {
      toastError('Update failed', String(err))
    },
  })

  function startDateEdit() {
    setDateDraft(experiment.date?.slice(0, 10) ?? '')
    setEditingDate(true)
  }

  function confirmDate() {
    const trimmed = dateDraft.trim()
    if (trimmed) {
      dateMutation.mutate(`${trimmed}T00:00:00`)
    } else {
      setEditingDate(false)
    }
  }

  function startEdit() {
    setIdDraft(experiment.experiment_id)
    setEditingId(true)
  }

  function confirmRename() {
    const trimmed = idDraft.trim()
    if (trimmed && trimmed !== experiment.experiment_id) {
      renameMutation.mutate(trimmed)
    } else {
      setEditingId(false)
    }
  }

  const experimentType = conditions?.experiment_type
  // Issue #156: an HPHT or Core Flood segment links its reactor to its run.
  const runPath = runPathFor(experimentType, experiment.base_experiment_id)
  const Heading = headingLevel

  const idRightElement =
    renameValidation.status === 'checking' ? (
      <span className="text-xs text-ink-muted animate-pulse">…</span>
    ) : renameValidation.status === 'available' ? (
      <span className="text-xs text-status-success">✓</span>
    ) : null

  return (
    <div className="space-y-4">
      <div>
        {editingId ? (
          <div className="flex items-center gap-2">
            <Input
              value={idDraft}
              onChange={(e) => setIdDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename()
                if (e.key === 'Escape') setEditingId(false)
              }}
              error={renameValidation.status === 'taken' ? renameValidation.message : undefined}
              rightElement={idRightElement}
              className="font-mono-data"
              autoFocus
            />
            <Button
              variant="primary"
              size="sm"
              disabled={
                renameValidation.status === 'taken' ||
                renameValidation.status === 'checking' ||
                !idDraft.trim()
              }
              onClick={confirmRename}
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditingId(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Heading className="text-lg font-semibold text-ink-primary font-mono-data">
              {experiment.experiment_id}
            </Heading>
            <button
              onClick={startEdit}
              className="text-ink-muted hover:text-ink-secondary transition-colors text-sm leading-none"
              title="Rename experiment"
              aria-label="Rename experiment"
            >
              ✎
            </button>
            <SegmentStatusSelect
              segment={experiment}
              onChanged={() =>
                invalidateStatusChange(
                  queryClient,
                  experiment.experiment_id,
                  experiment.base_experiment_id,
                  experimentType,
                )
              }
            />
            {experiment.is_outlier && (
              <Badge variant="warning">Outlier — excluded from group stats</Badge>
            )}
            {experiment.is_background && <Badge variant="info">Background</Badge>}
            {conditions?.experiment_type && (
              <span className="text-xs text-ink-muted">{conditions.experiment_type}</span>
            )}
          </div>
        )}

        {belowId}

        {/* Issue #118: the description is the note typed 'description';
            issue #122 PR-C: edited in place, or added when missing. */}
        {/* key={id}: a draft must never survive navigation to another experiment. */}
        <DescriptionEditor key={id} experimentId={id} note={descriptionNote} />

        <p className="text-xs text-ink-muted mt-0.5">
          #{experiment.experiment_number}
          {experiment.researcher && ` · ${experiment.researcher}`}
          {editingDate ? (
            <>
              {' · '}
              <input
                type="date"
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmDate()
                  if (e.key === 'Escape') setEditingDate(false)
                }}
                className="font-mono-data border border-surface-border rounded px-1 bg-surface-raised text-ink-primary"
                autoFocus
              />
              <button
                onClick={confirmDate}
                disabled={dateMutation.isPending}
                className="ml-1 text-status-success hover:opacity-80"
                title="Save date"
                aria-label="Save date"
              >
                ✓
              </button>
              <button
                onClick={() => setEditingDate(false)}
                className="ml-1 text-ink-muted hover:text-ink-secondary"
                title="Cancel"
                aria-label="Cancel date edit"
              >
                ✗
              </button>
            </>
          ) : (
            <button
              onClick={startDateEdit}
              className="text-ink-muted hover:text-ink-secondary transition-colors"
              title="Edit start date"
            >
              {experiment.date
                ? ` · ${experiment.date.slice(0, 10)}`
                : ' · Set start date'}
            </button>
          )}
          {!editingSampleId && (
            <button
              onClick={() => { setEditingSampleId(true); setSampleDraft(experiment.sample_id ?? '') }}
              className="text-ink-muted hover:text-ink-secondary transition-colors"
              title="Change sample"
            >
              {experiment.sample_id
                ? ` · Sample: ${experiment.sample_id}`
                : ' · Assign sample'}
            </button>
          )}
          {conditions?.reactor_number != null && (
            <>
              {' · '}
              {runPath && !reactorAsText ? (
                <Link
                  to={runPath}
                  className="underline decoration-dotted underline-offset-2 hover:text-ink-secondary"
                >
                  Reactor {conditions.reactor_slot ?? conditions.reactor_number}
                </Link>
              ) : (
                `Reactor ${conditions.reactor_slot ?? conditions.reactor_number}`
              )}
            </>
          )}
        </p>

        {/* Inline sample ID editor */}
        {editingSampleId && (
          <div className="flex items-start gap-2 mt-1">
            <div className={`w-64${sampleMutation.isPending ? ' pointer-events-none opacity-50' : ''}`}>
              <SampleSelector
                value={sampleDraft}
                onChange={(newSampleId) => setSampleDraft(newSampleId)}
              />
            </div>
            {sampleDraft && sampleDraft !== experiment.sample_id && (
              <Button
                variant="primary"
                size="sm"
                className="mt-5"
                onClick={() => sampleMutation.mutate(sampleDraft)}
                disabled={sampleMutation.isPending}
              >
                Save
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-5"
              onClick={() => { setSampleDraft(''); setEditingSampleId(false) }}
              disabled={sampleMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        {!embedded && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/experiments/new')}>
            + New Experiment
          </Button>
        )}
        {!embedded && experiment.replicate_label === null && experiment.parent_experiment_fk === null && (
          <Button variant="secondary" size="sm" onClick={() => setReplicatesOpen(true)}>
            Create Replicates
          </Button>
        )}
        {inReplicateSet && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => outlierMutation.mutate(!experiment.is_outlier)}
            disabled={outlierMutation.isPending}
          >
            {experiment.is_outlier ? 'Include in rollup' : 'Mark as outlier'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => backgroundMutation.mutate(!experiment.is_background)}
          disabled={backgroundMutation.isPending}
        >
          {experiment.is_background ? 'Unmark background' : 'Mark as background'}
        </Button>
        {!embedded && <ExportAllButton experimentId={experiment.experiment_id} />}
        <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete Experiment
        </Button>
      </div>
      <CreateReplicatesModal
        open={replicatesOpen}
        onClose={() => setReplicatesOpen(false)}
        baseExperimentId={experiment.experiment_id}
      />
      <DeleteExperimentModal
        open={deleteOpen}
        experimentId={experiment.experiment_id}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          const deletedId = experiment.experiment_id
          setDeleteOpen(false)
          success('Experiment deleted')
          // The caller navigates BEFORE the cache is touched. Several of the keys
          // below are still actively observed by the page, and removing/invalidating
          // an active query makes React Query refetch it — against an experiment
          // that no longer exists, producing a burst of 404s in the console.
          onDeleted(deletedId)
          // Deferred to a macrotask so the eviction lands after React has
          // committed the navigation and unmounted this page's observers.
          // A microtask is not enough: it can still run before that commit.
          setTimeout(() => {
            // Drop every cache keyed by this experiment's ID, so a freed
            // experiment_id reused later cannot read back the deleted row.
            PER_EXPERIMENT_QUERY_KEYS.forEach((key) =>
              queryClient.removeQueries({ queryKey: [key, deletedId] }),
            )
            queryClient.invalidateQueries({ queryKey: ['experiments'] })
            GROUP_QUERY_PREFIXES.forEach((key) =>
              queryClient.invalidateQueries({ queryKey: [key] }),
            )
          }, 0)
        }}
      />
    </div>
  )
}
