import { useQuery } from '@tanstack/react-query'
import { resultsApi } from '@/api/results'
import { Num, Spinner } from '@/components/ui'

/** DETAILS extras of a sample: scalar values that are not table columns (DO and
 *  the hand-entered Fe²⁺ yield). Loaded when the section opens (the list payloads do not carry them).
 *  Used by the Results tab and both run pages. */
export function ScalarExtras({ resultId }: { resultId: number }) {
  const { data: scalar, isLoading } = useQuery({
    queryKey: ['scalar', resultId],
    queryFn: () => resultsApi.getScalar(resultId),
  })
  if (isLoading) return <Spinner size="sm" />
  if (!scalar) return null
  const values = ([
    ['DO', scalar.final_dissolved_oxygen_mg_L, 'mg/L'],
    // The hand-entered value, not the calculated Fe²⁺ H₂ % column (issue #42).
    ['Fe²⁺ yield (entered)', scalar.ferrous_iron_yield, '%'],
  ] as const).filter(([, v]) => v != null)
  if (values.length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold text-ink-secondary mb-1">Scalar Results</p>
      <div className="grid grid-cols-4 gap-x-4 gap-y-1">
        {values.map(([label, v, unit]) => (
          <div key={label} className="text-xs">
            <span className="text-ink-muted">{label}: </span>
            <span className="font-mono-data text-ink-primary"><Num value={v} />{unit ? ` ${unit}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A run page's `detailsExtra`: every sample's DETAILS can hold DO and the entered Fe²⁺ yield. */
export function scalarDetails(row: { resultId: number }) {
  return <ScalarExtras resultId={row.resultId} />
}
