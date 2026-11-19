import { Link, useSearchParams } from 'react-router-dom'
import type { RunSegment } from '@/api/runs'
import { stripOrder } from '@/components/experiments/runContext'
import { Badge } from '@/components/ui'
import { runViewSearch, type RunView } from './runView'

const CHIP = 'px-2.5 py-1 rounded text-xs border transition-colors'
const CHIP_ON = 'border-brand-red text-ink-primary bg-surface-raised'
const CHIP_OFF = 'border-surface-border text-ink-muted hover:text-ink-secondary'

/** Chooses which segment of a run the page shows. Links, so the choice lives in the
 *  URL; the current tab is kept. Renders nothing for a single-segment run. */
export function SegmentPicker({ segments, view }: { segments: RunSegment[]; view: RunView }) {
  const [params] = useSearchParams()
  if (segments.length <= 1) return null

  return (
    <nav aria-label="Segments" className="flex flex-wrap items-center gap-2">
      <Link
        to={runViewSearch(params, { segmentId: null })}
        aria-current={!view.explicit ? 'true' : undefined}
        className={`${CHIP} ${!view.explicit ? CHIP_ON : CHIP_OFF}`}
      >
        Whole run
      </Link>
      {stripOrder(segments).map((s) => {
        const current = view.explicit && s.experiment_id === view.segmentId
        return (
          <span key={s.experiment_id} className="inline-flex items-center gap-1">
            <Link
              to={runViewSearch(params, { segmentId: s.experiment_id })}
              aria-current={current ? 'true' : undefined}
              className={`${CHIP} font-mono-data ${current ? CHIP_ON : CHIP_OFF}`}
            >
              {s.experiment_id}
            </Link>
            {s.status?.toUpperCase() === 'ONGOING' && <Badge variant="info">Ongoing</Badge>}
          </span>
        )
      })}
      {view.explicit && (
        <Link
          to={runViewSearch(params, { segmentId: view.segmentId, only: !view.only })}
          className="ml-2 text-xs text-red-400 hover:text-red-300"
        >
          {view.only ? "All of the run's samples" : "Only this segment's samples"}
        </Link>
      )}
    </nav>
  )
}
