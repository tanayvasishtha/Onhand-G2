import { describe, expect, it } from 'vitest'
import { parse, prepare } from '../src/parse'
import { applyPatch } from '../src/engine'
import type { Query } from '../src/types'
import { cars, menu, units } from './fixtures'

describe('prepare', () => {
  it.each([
    ['two and a half million', '2.5 million'],
    ['one point two crore', '1.2 crore'],
    ['twenty five lakh', '25 lakh'],
    ['half a million', '0.5 million'],
    ['2,500,000', '2500000'],
  ])('%s', (input, want) => expect(prepare(input)).toBe(want))
})

const f = (text: string, sheet = units) => parse(text, sheet).set
const byKey = (text: string, sheet = units) => Object.fromEntries(f(text, sheet).map(x => [`${x.key}:${x.op}`, x]))

describe('Dubai units requests', () => {
  it('the hero request', () => {
    const p = parse('Two-bed in Marina, under two and a half, sea view', units)
    expect(p.set).toEqual(
      expect.arrayContaining([
        { key: 'beds', op: 'range', min: 2, max: 2 },
        { key: 'area', op: 'in', values: ['Dubai Marina'] },
        { key: 'price', op: 'range', max: 2_500_000 },
        { key: 'view', op: 'in', values: ['Sea'] },
      ]),
    )
    expect(p.unparsed).toBe('')
  })

  it.each([
    ['studio in JVC', { 'beds:range': { key: 'beds', op: 'range', min: 0, max: 0 }, 'area:in': { key: 'area', op: 'in', values: ['JVC'] } }],
    ['3 bedrooms or more in Dubai Hills', { 'beds:range': { key: 'beds', op: 'range', min: 3 }, 'area:in': { key: 'area', op: 'in', values: ['Dubai Hills'] } }],
    ['between 1.5 and 2 million', { 'price:range': { key: 'price', op: 'range', min: 1_500_000, max: 2_000_000 } }],
    ['around 3M', { 'price:range': { key: 'price', op: 'range', min: 2_700_000, max: 3_300_000 } }],
    ['budget is 25 lakh', { 'price:range': { key: 'price', op: 'range', max: 2_500_000 } }],
    ['AED 1,800,000 max', { 'price:range': { key: 'price', op: 'range', max: 1_800_000 } }],
    ['under 900k', { 'price:range': { key: 'price', op: 'range', max: 900_000 } }],
    ['jumeirah village circle', { 'area:in': { key: 'area', op: 'in', values: ['JVC'] } }],
    ['Marina or JLT', { 'area:in': { key: 'area', op: 'in', values: ['Dubai Marina', 'JLT'] } }],
    ['anything but Downtown', { 'area:not_in': { key: 'area', op: 'not_in', values: ['Downtown'] } }],
    ['pet friendly please', { 'pets:is': { key: 'pets', op: 'is', value: true } }],
    ['no pets', { 'pets:is': { key: 'pets', op: 'is', value: false } }],
    ['unfurnished', { 'furnished:is': { key: 'furnished', op: 'is', value: false } }],
    ['ready to move in', { 'handover:range': { key: 'handover', op: 'range', max: 0 } }],
    ['off plan is fine', { 'handover:range': { key: 'handover', op: 'range', min: 1 } }],
    ['handover by 2027', { 'handover:range': { key: 'handover', op: 'range', max: 2027 * 12 + 11 } }],
    ['golf view in the hills', { 'view:in': { key: 'view', op: 'in', values: ['Golf'] }, 'area:in': { key: 'area', op: 'in', values: ['Dubai Hills'] } }],
    ['over 1200 sqft', { 'size:range': { key: 'size', op: 'range', min: 1200 } }],
  ])('%s', (text, want) => expect(byKey(text)).toMatchObject(want))

  it('"marina view" is a view, not the area', () => {
    const k = byKey('one bed with a marina view in JLT')
    expect(k['view:in']).toEqual({ key: 'view', op: 'in', values: ['Marina'] })
    expect(k['area:in']).toEqual({ key: 'area', op: 'in', values: ['JLT'] })
  })

  it('a spoken "2.5" means 2.5M on a sheet where every price is over a million', () => {
    expect(byKey('under 2.5')['price:range']).toEqual({ key: 'price', op: 'range', max: 2_500_000 })
  })

  it('commands and sorting', () => {
    expect(parse('compare 1 and 2', units).command).toEqual({ kind: 'compare', a: 0, b: 1 })
    expect(parse('tell me about 2', units).command).toEqual({ kind: 'detail', index: 1 })
    expect(parse('how many in JVC', units).command).toEqual({ kind: 'count' })
    expect(parse('show me the cheapest', units).sort).toEqual({ key: 'price', dir: 'asc' })
    expect(parse('the biggest ones', units).sort).toEqual({ key: 'size', dir: 'desc' })
    expect(parse('start over', units).clear).toBe(true)
  })
})

describe('change of mind across turns', () => {
  const turns = (...texts: string[]): Query => texts.reduce<Query>((q, t) => applyPatch(q, parse(t, units)), { filters: [] })

  it('"actually Downtown" replaces the area', () => {
    const q = turns('2 bed in Marina under 2.5M', 'actually Downtown instead')
    expect(q.filters.find(x => x.key === 'area')).toEqual({ key: 'area', op: 'in', values: ['Downtown'] })
    expect(q.filters).toHaveLength(3)
  })
  it('"forget the view" removes it', () => {
    const q = turns('2 bed Marina sea view', 'forget the view')
    expect(q.filters.some(x => x.key === 'view')).toBe(false)
  })
  it('"pets doesnt matter" removes pets', () => {
    const q = turns('2 bed Marina, must allow pets', "pets doesn't matter")
    expect(q.filters.some(x => x.key === 'pets')).toBe(false)
  })
  it('"start over" clears everything', () => {
    expect(turns('2 bed Marina', 'start over, studio in JVC').filters).toEqual([
      { key: 'beds', op: 'range', min: 0, max: 0 },
      { key: 'area', op: 'in', values: ['JVC'] },
    ])
  })
})

describe('restaurant and car sheets, same parser', () => {
  it('nut-free asks for rows without nuts (pine nuts count)', () => {
    expect(byKey('anything nut free?', menu)['allergens:lacks']).toEqual({ key: 'allergens', op: 'lacks', values: ['nuts'] })
    const lacks = byKey('no dairy and no gluten', menu)['allergens:lacks'] as { values: string[] }
    expect([...lacks.values].sort()).toEqual(['dairy', 'gluten'])
  })
  it('"does the risotto have nuts?" narrows to risottos and does not filter on nuts', () => {
    const k = byKey('does the risotto have nuts?', menu)
    expect(k['section:in']).toEqual({ key: 'section', op: 'in', values: ['Risotto'] })
    expect(k['allergens:has']).toBeUndefined()
  })
  it('vegan', () => expect(byKey('something vegan', menu)['vegan:is']).toEqual({ key: 'vegan', op: 'is', value: true }))
  it('a white SUV under 90k', () => {
    expect(byKey('a white SUV under 90k', cars)).toMatchObject({
      'price:range': { max: 90_000 },
      'colour:in': { values: ['White'] },
      'body:in': { values: ['SUV'] },
    })
  })
  it('mileage words go to mileage, not price', () => {
    const k = byKey('2022 or newer with under 50,000 km', cars)
    expect(k['mileage:range']).toEqual({ key: 'mileage', op: 'range', max: 50_000 })
    expect(k['year:range']).toEqual({ key: 'year', op: 'range', min: 2022 })
    expect(k['price:range']).toBeUndefined()
  })
  it('a hybrid Toyota', () => {
    expect(byKey('hybrid toyota', cars)).toMatchObject({ 'fuel:in': { values: ['Hybrid'] }, 'make:in': { values: ['Toyota'] } })
  })
})

describe('speech-to-text spellings', () => {
  it('reads "Seaview" written as one word', async () => {
    const { units } = await import('./fixtures')
    const { parse } = await import('../src/parse')
    expect(parse('2 bed in Marina. Under 2,500,000. Seaview,', units).set).toContainEqual({ key: 'view', op: 'in', values: ['Sea'] })
  })
})
