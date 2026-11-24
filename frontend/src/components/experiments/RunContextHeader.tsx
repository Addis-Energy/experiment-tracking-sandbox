import { Link } from 'react-router-dom'
import type { ExperimentDetail, ReplicateGroup } from '@/api/experiments'
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui'
import { SegmentLink } from '@/components/runs/SegmentLink'
import { runPathFor } from '@/utils/experimentId'
import { isInReplicateSet } from './runContext'

const STRIP = 'text-xs text-ink-muted flex flex-wrap items-center gap-x-1.5'
const PARENT_LINK = 'text-red-400 hover:text-red-300 font-mono-data'
const CURRENT = 'font-semibold text-ink-primary'

interface ContextProps {
  /** Letter-only replicate set of the experiment (`GET .../replicate-group`). */
  replicateGroup: ReplicateGroup | undefined
  /** Vial count of the stem's group (`GET /experiments/groups/{base}`, issue #101). */
  groupMemberCount: number | undefined
}

function groupContext(
  experiment: Pick<ExperimentDetail, 'experiment_id' | 'base_experiment_id' | 'replicate_label'>,
  { replicateGroup, groupMemberCount }: ContextProps,
) {
  const inReplicateSet = isInReplicateSet(
    experiment.replicate_label,
    replicateGroup?.members.length,
    groupMemberCount,
  )
  const groupBaseId =
    replicateGroup?.base_experiment_id ?? experiment.base_experiment_id ?? experiment.experiment_id
  const groupPath = `/experiments/groups/${encodeURIComponent(groupBaseId)}`
  return { inReplicateSet, groupBaseId, groupPath }
}

/** Detail-page breadcrumb that names where an experiment sits: its run (HPHT or
 *  Core Flood segment), its replicate group (serum vial), or neither (issue #156). */
export function ExperimentBreadcrumb({
  experiment,
  experimentType,
  replicateGroup,
  groupMemberCount,
}: ContextProps & {
  experiment: Pick<ExperimentDetail, 'experiment_id' | 'base_experiment_id' | 'replicate_label'>
  experimentType: string | null | undefined
}) {
  const baseId = experiment.base_experiment_id
  const runPath = runPathFor(experimentType, baseId)
  const { inReplicateSet, groupBaseId, groupPath } = groupContext(experiment, {
    replicateGroup,
    groupMemberCount,
  })

  const items: BreadcrumbItem[] = [{ label: 'Experiments', to: '/experiments' }]
  // A run outranks a group: no experiment is both today, and the run is the richer page.
  if (runPath && baseId) items.push({ label: `Run ${baseId}`, to: runPath, mono: true })
  else if (inReplicateSet) items.push({ label: `Group ${groupBaseId}`, to: groupPath, mono: true })
  items.push({ label: experiment.experiment_id, mono: true })

  return <Breadcrumb className="mb-1" items={items} />
}

/** The serum replicate-group strip: replicate letter, group link, sibling chips. */
export function GroupStrip({
  experiment,
  replicateGroup,
  groupMemberCount,
}: ContextProps & {
  experiment: Pick<ExperimentDetail, 'id' | 'experiment_id' | 'base_experiment_id' | 'replicate_label'>
}) {
  const { inReplicateSet, groupBaseId, groupPath } = groupContext(experiment, {
    replicateGroup,
    groupMemberCount,
  })
  if (!inReplicateSet) return null

  return (
    <p className={STRIP}>
      {experiment.replicate_label !== null && (
        <>
          <span>Replicate {experiment.replicate_label}</span>
          <span>·</span>
        </>
      )}
      <span>
        Group{' '}
        <Link to={groupPath} className={PARENT_LINK}>
          {groupBaseId}
        </Link>
      </span>
      {replicateGroup && replicateGroup.members.length > 0 && (
        <>
          <span>·</span>
          <span className="flex flex-wrap items-center gap-1 font-mono-data">
            {replicateGroup.members.map((member) =>
              member.id === experiment.id ? (
                <span key={member.id} className={CURRENT}>
                  [{member.replicate_label ?? member.experiment_id}]
                </span>
              ) : (
                <SegmentLink key={member.id} id={member.experiment_id}>
                  {member.replicate_label ?? member.experiment_id}
                </SegmentLink>
              ),
            )}
          </span>
        </>
      )}
    </p>
  )
}
