import { describe, it, expect } from 'vitest'
import { reactorFilterParam, slotLabelsFor, slotToConditions } from '../reactorSlots'

describe('reactorSlots (issue #147)', () => {
  it('splits a picked label into number and series', () => {
    expect(slotToConditions('P03', 'HPHT')).toEqual({ reactor_number: 3, reactor_series: 'P' })
    expect(slotToConditions('R12', 'hpht')).toEqual({ reactor_number: 12, reactor_series: null })
    expect(slotToConditions('CF02', 'Core Flood')).toEqual({ reactor_number: 2, reactor_series: null })
  })

  it('rejects a label that is not one of the type\'s slots', () => {
    expect(slotToConditions('P03', 'Core Flood')).toBeNull()
    expect(slotToConditions('R03', 'Serum')).toBeNull()
    expect(slotToConditions('', 'HPHT')).toBeNull()
  })

  it('has no slots for non-occupancy types', () => {
    expect(slotLabelsFor('Serum')).toEqual([])
    expect(slotLabelsFor(null)).toEqual([])
  })
})

describe('reactorFilterParam (reactor-labels)', () => {
  it('passes a complete label or number, trimmed', () => {
    expect(reactorFilterParam('P3')).toBe('P3')
    expect(reactorFilterParam(' r03 ')).toBe('r03')
    expect(reactorFilterParam('CF1')).toBe('CF1')
    expect(reactorFilterParam('7')).toBe('7')
  })

  it('holds back anything the API would reject, so typing never errors', () => {
    for (const partial of ['', 'P', 'R0', 'abc', '0', 'CF', '3.5'])
      expect(reactorFilterParam(partial)).toBeUndefined()
  })
})
