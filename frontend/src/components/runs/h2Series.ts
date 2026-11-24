import { segmentStarts, type ChartMarker } from '@/components/icp/icpSeries'

/** The sample fields the H₂ charts read; H2Sample and CoreFloodSample both fit. */
export interface H2Sample {
  result_id: number
  experiment_id: string
  is_variant: boolean
  cumulative_time_post_reaction_days: number | null
  h2_grams_per_ton_yield: number | null
  cumulative_h2_grams_per_ton: number | null
  h2_grams_per_ton_per_day: number | null
  /** Absent on core flood samples. */
  cumulative_ferrous_iron_yield_h2_pct?: number | null
}

/** One point of the run charts. NULL stays NULL so Recharts draws a gap,
 *  never a dip to zero. */
export interface H2Point {
  day: number
  /** Cumulative H₂ to date (g/t). */
  cumH2: number | null
  /** H₂ per day over the interval since the previous sample (g/t/day). */
  rate: number | null
  /** Cumulative Fe²⁺ → H₂ yield to date (%). */
  cumFe: number | null
}

/** Main-line samples (variants excluded) that have a cumulative day, in day order. */
export function chartPoints(samples: H2Sample[]): H2Point[] {
  return samples
    .filter((s) => !s.is_variant && s.cumulative_time_post_reaction_days != null)
    .sort(
      (a, b) =>
        a.cumulative_time_post_reaction_days! - b.cumulative_time_post_reaction_days! ||
        a.result_id - b.result_id,
    )
    .map((s) => ({
      day: s.cumulative_time_post_reaction_days!,
      cumH2: s.cumulative_h2_grams_per_ton,
      rate: s.h2_grams_per_ton_per_day,
      cumFe: s.cumulative_ferrous_iron_yield_h2_pct ?? null,
    }))
}

/** True when any main-line sample has an H₂ yield; otherwise the charts show an empty state. */
export function hasH2(samples: H2Sample[]): boolean {
  return samples.some((s) => !s.is_variant && s.h2_grams_per_ton_yield != null)
}

/** True when any point carries a Fe²⁺ yield (core flood samples never do). */
export function hasFeYield(points: H2Point[]): boolean {
  return points.some((p) => p.cumFe != null)
}

/** Dashed segment-start lines: the first sample of each non-variant segment
 *  after the first (the same rule as the run ICP chart). */
export function chartMarkers(samples: H2Sample[]): ChartMarker[] {
  return segmentStarts(samples)
}
