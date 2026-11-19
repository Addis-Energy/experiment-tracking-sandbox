import type { HphtRun, HphtSample } from '@/api/hpht'
import type { ExperimentDetail } from '@/api/experiments'
import type { RunSegment } from '@/api/runs'

export const segment = (over: Partial<RunSegment>): RunSegment => ({
  id: 1,
  experiment_id: 'HPHT_297',
  status: 'COMPLETED',
  date: '2026-09-01T00:00:00',
  parent_experiment_id: null,
  is_variant: false,
  description: 'Olivine, 200 °C',
  conditions_id: 1,
  pore_volume_mL: null,
  rock_mass_g: 10,
  reactor_slot: 'R07',
  ...over,
})

export const sample = (over: Partial<HphtSample>): HphtSample => ({
  result_id: 1,
  experiment_id: 'HPHT_297',
  experiment_fk: 1,
  run_base_id: 'HPHT_297',
  is_variant: false,
  time_post_reaction_days: 1,
  cumulative_time_post_reaction_days: 1,
  sample_date: '2026-09-02T00:00:00',
  gc_run_date: null,
  sample_tube_number: 3,
  sampling_volume_mL: null,
  h2_concentration: 1000,
  gas_sampling_volume_ml: null,
  gas_sampling_pressure_MPa: null,
  h2_micromoles: 1.5,
  h2_mass_ug: null,
  h2_grams_per_ton_yield: 0.1,
  ferrous_iron_yield_h2_pct: 0.5,
  final_ph: 7.1,
  final_conductivity_mS_cm: 4.2,
  reactor_slot: 'R07',
  interval_days: 1,
  cumulative_h2_grams_per_ton: 0.1,
  h2_grams_per_ton_per_day: 0.1,
  cumulative_h2_micromoles: 1.5,
  cumulative_ferrous_iron_yield_h2_pct: 0.5,
  notes: [],
  ...over,
})

/** HPHT_297 and its -2 segment (ONGOING), plus a desorption variant. */
export const RUN: HphtRun = {
  base_id: 'HPHT_297',
  warnings: [],
  conditions: {
    experiment_id: 'HPHT_297-2',
    conditions_id: 2,
    date: '2026-09-10T00:00:00',
    sample_id: 'ROCK_42',
    temperature_c: 200,
    rxn_temp_pressure_psi: 1500,
    rock_mass_g: 10,
    water_volume_mL: 100,
    water_to_rock_ratio: 10,
    catalyst: null,
    catalyst_ppm: null,
    feedstock: 'Olivine',
  },
  segments: [
    segment({}),
    segment({
      id: 2,
      experiment_id: 'HPHT_297-2',
      status: 'ONGOING',
      parent_experiment_id: 'HPHT_297',
      date: '2026-09-10T00:00:00',
      description: null,
    }),
    segment({
      id: 3,
      experiment_id: 'HPHT_297-2_Desorption',
      parent_experiment_id: 'HPHT_297-2',
      is_variant: true,
      reactor_slot: null,
    }),
  ],
  samples: [
    sample({ result_id: 10, sample_tube_number: 3, notes: [
      { id: 1, note_type: 'result_note', note_text: 'First draw', created_by: null },
    ] }),
    sample({
      result_id: 11,
      cumulative_time_post_reaction_days: 4,
      sample_date: '2026-09-05T00:00:00',
      sample_tube_number: 4,
      cumulative_h2_grams_per_ton: 0.3,
      h2_grams_per_ton_per_day: null,
    }),
    sample({
      result_id: 13,
      experiment_id: 'HPHT_297-2_Desorption',
      is_variant: true,
      cumulative_time_post_reaction_days: 6,
      sample_tube_number: 99,
      h2_grams_per_ton_yield: 9.9,
      cumulative_h2_grams_per_ton: null,
      h2_grams_per_ton_per_day: null,
      cumulative_ferrous_iron_yield_h2_pct: null,
      notes: [{ id: 3, note_type: 'result_note', note_text: 'Desorption draw', created_by: null }],
    }),
    sample({
      result_id: 12,
      experiment_id: 'HPHT_297-2',
      cumulative_time_post_reaction_days: 8,
      sample_date: '2026-09-12T00:00:00',
      sample_tube_number: 5,
      cumulative_h2_grams_per_ton: 0.7,
      h2_grams_per_ton_per_day: 0.1,
      notes: [{ id: 2, note_type: 'modification', note_text: 'Topped up brine', created_by: null }],
    }),
  ],
}

const nonVariant = (r: HphtRun) => r.samples.filter((x) => !x.is_variant)
/** Non-variant samples on RUN: what the Samples table shows for the whole run. */
export const MAIN_SAMPLE_COUNT = nonVariant(RUN).length
/** ... and those on the HPHT_297-2 segment. */
export const SEGMENT_2_SAMPLE_COUNT = nonVariant(RUN).filter((x) => x.experiment_id === 'HPHT_297-2').length

/** A run with one segment (no picker, no Segments section). */
export const SINGLE_RUN: HphtRun = {
  base_id: 'HPHT_304',
  warnings: [],
  conditions: { ...RUN.conditions!, experiment_id: 'HPHT_304', conditions_id: 5 },
  segments: [segment({ id: 5, experiment_id: 'HPHT_304', status: 'ONGOING', conditions_id: 5 })],
  samples: [
    sample({ result_id: 40, experiment_id: 'HPHT_304', run_base_id: 'HPHT_304', experiment_fk: 5 }),
  ],
}

/** Detail of HPHT_297-2 with four notes (the Notes tab count). */
export const SEG_2_DETAIL: ExperimentDetail = {
  id: 2,
  experiment_id: 'HPHT_297-2',
  experiment_number: 297,
  status: 'ONGOING',
  researcher: null,
  date: '2026-09-10T00:00:00',
  sample_id: null,
  base_experiment_id: 'HPHT_297',
  parent_experiment_fk: 1,
  replicate_label: null,
  is_outlier: false,
  id_timepoint_days: null,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: null,
  conditions: null,
  notes: [1, 2, 3, 4].map((id) => ({
    id, experiment_id: 'HPHT_297-2', note_type: 'observation', note_text: `note ${id}`,
    result_id: null, created_by: null, needs_review: false,
    created_at: '2026-09-11T00:00:00Z', updated_at: null,
  })),
  modifications: [],
}
