/** Physical reactor slots a researcher can pick (issue #147).
 *
 *  A slot is a series plus a number: R01-R16 (Yushen/Tan HPHT), P01-P06 (Parr
 *  HPHT, stored as reactor_series = 'P') and CF01-CF03 (Core Flood rigs). The
 *  backend derives the stored label in database/reactor_slot.py; this module only
 *  builds the picker options and splits a picked label back into the two
 *  columns the conditions API takes. */
import { isCoreFloodType, isHphtType } from './experimentId'

export const R_SLOT_COUNT = 16
export const P_SLOT_COUNT = 6
export const CF_SLOT_COUNT = 3

/** Series stored in reactor_series; null is the type's default series. */
export type ReactorSeries = 'P' | null

export interface SlotOption {
  value: string
  label: string
}

const labels = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)

/** The slots an experiment of this type can occupy, in picker order. */
export function slotLabelsFor(experimentType: string | null | undefined): string[] {
  if (isHphtType(experimentType)) return [...labels('R', R_SLOT_COUNT), ...labels('P', P_SLOT_COUNT)]
  if (isCoreFloodType(experimentType)) return labels('CF', CF_SLOT_COUNT)
  return []
}

/** Picker options; Parr slots are marked so they are not mistaken for R slots. */
export function slotOptionsFor(experimentType: string | null | undefined): SlotOption[] {
  return slotLabelsFor(experimentType).map((value) => ({
    value,
    label: value.startsWith('P') ? `${value} (Parr)` : value,
  }))
}

/** Split a slot label into the conditions columns. Null for anything that is
 *  not one of the type's slots (e.g. a label left over from another type). */
export function slotToConditions(
  label: string,
  experimentType: string | null | undefined,
): { reactor_number: number; reactor_series: ReactorSeries } | null {
  if (!slotLabelsFor(experimentType).includes(label)) return null
  const match = /^(CF|R|P)(\d+)$/.exec(label)
  if (!match) return null
  return { reactor_number: Number(match[2]), reactor_series: match[1] === 'P' ? 'P' : null }
}

/** The Reactor filter text as the list API's `reactor` param: a slot label
 *  ('P3', 'R03', 'CF1') or a plain number, trimmed. Undefined while the text is
 *  blank or still partial ('P', 'R0'), so typing a label never sends a value
 *  the API answers with 422. Mirrors database/reactor_slot.py::parse_reactor_reference. */
export function reactorFilterParam(text: string): string | undefined {
  const trimmed = text.trim()
  return /^(cf|r|p)?\s*0*[1-9]\d*$/i.test(trimmed) ? trimmed : undefined
}
