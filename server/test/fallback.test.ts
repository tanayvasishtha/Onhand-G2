import { describe, expect, it } from 'vitest'
import { validate } from '../src/fallback'
import { keyterms } from '../src/listen'
import { cars, menu, units } from '../../shared/test/fixtures'

const f = (o: Record<string, unknown>) => ({ min: null, max: null, values: null, value: null, q: null, ...o }) as any

describe('Claude fallback output is checked against the sheet', () => {
  it('keeps filters on real columns with real values, in canonical spelling', () => {
    const { set, dropped } = validate([f({ key: 'area', op: 'in', values: ['dubai marina'] }), f({ key: 'pets', op: 'is', value: true })], units)
    expect(set).toEqual([
      { key: 'area', op: 'in', values: ['Dubai Marina'] },
      { key: 'pets', op: 'is', value: true },
    ])
    expect(dropped).toEqual([])
  })
  it('drops made-up columns and values', () => {
    const { set, dropped } = validate([f({ key: 'type', op: 'in', values: ['Villa'] }), f({ key: 'area', op: 'in', values: ['JBR'] })], units)
    expect(set).toEqual([])
    expect(dropped).toHaveLength(2)
  })
  it('drops ops that do not fit the column type', () => {
    expect(validate([f({ key: 'price', op: 'is', value: true }), f({ key: 'handover', op: 'range', max: 5 })], units).set).toEqual([])
    expect(validate([f({ key: 'allergens', op: 'in', values: ['nuts'] })], menu).set).toEqual([])
  })
  it('accepts list values and open ranges', () => {
    expect(validate([f({ key: 'allergens', op: 'lacks', values: ['Sesame'] })], menu).set).toEqual([{ key: 'allergens', op: 'lacks', values: ['sesame'] }])
    expect(validate([f({ key: 'mileage', op: 'range', max: 40000 })], cars).set).toEqual([{ key: 'mileage', op: 'range', max: 40000 }])
  })
})

describe('speech key terms', () => {
  it('include areas and project names, capped', () => {
    const k = keyterms(units)
    expect(k).toContain('Dubai Marina')
    expect(k.length).toBeLessThanOrEqual(40)
  })
})
