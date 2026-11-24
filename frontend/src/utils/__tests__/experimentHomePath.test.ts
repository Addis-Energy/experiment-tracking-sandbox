import { describe, it, expect } from 'vitest'
import { experimentHomePath } from '../experimentId'

describe('experimentHomePath', () => {
  it.each([
    ['HPHT', 'HPHT_297-2', 'HPHT_297', undefined, '/hpht/HPHT_297?segment=HPHT_297-2'],
    ['Core Flood', 'CF_027-6', 'CF_027', 'notes', '/core-floods/CF_027?segment=CF_027-6&tab=notes'],
    ['hpht', 'HPHT_304', 'HPHT_304', undefined, '/hpht/HPHT_304?segment=HPHT_304'],
    ['Serum', 'SERUM_001a', 'SERUM_001', undefined, '/experiments/SERUM_001a'],
    ['SERUM', 'SERUM_001a', 'SERUM_001', 'results', '/experiments/SERUM_001a?tab=results'],
    ['HPHT', 'HPHT_X', null, undefined, '/experiments/HPHT_X'],
    [null, 'A/B', null, undefined, '/experiments/A%2FB'],
  ])('%s %s -> %s', (type, id, base, tab, expected) => {
    expect(experimentHomePath(type, id, base, tab)).toBe(expected)
  })
})
