import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applyPatch, check, diffRows, run } from '../src/engine'
import { loadCsv, parseCsv } from '../src/sheet'
import type { Filter, Query } from '../src/types'
import { cars, menu, units } from './fixtures'

describe('sheets load', () => {
  it('Dubai units: 250 rows, 4 unreadable prices reported, 4 duplicates folded', () => {
    expect(units.rows).toHaveLength(250)
    expect(units.skipped.map(s => s.r)).toEqual([55, 90, 142, 203])
    expect(units.duplicates).toBe(4)
  })
  it('restaurant menu and car stock load fully', () => {
    expect(menu.rows).toHaveLength(60)
    expect(cars.rows).toHaveLength(83)
  })
  it('a duplicate keeps the later row', () => {
    const csv = 'Project,Unit,Area,Bedrooms,Price (AED)\nA,1,JVC,1,1M\nA,1,JVC,1,900k\n'
    const s = loadCsv(csv, units.schema)
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0].values.price).toBe(900_000)
    expect(s.rows[0].r).toBe(3)
  })
  it('a missing required column is an error, not an empty result', () => {
    expect(() => loadCsv('Project,Unit\nA,1\n', units.schema)).toThrow(/missing required columns/)
  })
  it('reads quoted CSV fields', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
  })
})

const hero: Query = {
  filters: [
    { key: 'beds', op: 'range', min: 2, max: 2 },
    { key: 'area', op: 'in', values: ['Dubai Marina'] },
    { key: 'price', op: 'range', max: 2_500_000 },
    { key: 'view', op: 'in', values: ['Sea'] },
  ],
}

describe('hero story on the Dubai sheet', () => {
  it('2BR | Marina | <=2.5M | Sea gives the hand-written units, cheapest first', () => {
    const res = run(units.rows, units.schema, hero)
    expect(res.relaxed).toBeUndefined()
    expect(res.total).toBeGreaterThanOrEqual(3)
    const prices = res.hits.map(h => h.row.values.price as number)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(res.hits.map(h => h.row.raw.unit)).toEqual(expect.arrayContaining(['0907', '1804']))
  })

  it('adding pets drops the unit that does not allow them', () => {
    const q = applyPatch(hero, { set: [{ key: 'pets', op: 'is', value: true }], remove: [] })
    const res = run(units.rows, units.schema, q)
    expect(res.hits.some(h => h.row.raw.project === 'Seawind Tower' && h.row.raw.unit === '2210')).toBe(false)
    for (const h of res.hits.slice(0, res.total)) expect(h.row.values.pets).toBe(true)
  })

  it('3BR under 2M in the Marina has no match, and the nearest is the 2.18M unit', () => {
    const q: Query = {
      filters: [
        { key: 'beds', op: 'range', min: 3, max: 3 },
        { key: 'area', op: 'in', values: ['Dubai Marina'] },
        { key: 'price', op: 'range', max: 2_000_000 },
      ],
    }
    const res = run(units.rows, units.schema, q)
    expect(res.relaxed?.keys).toEqual(['price'])
    expect(res.hits[0].row.values.price).toBe(2_180_000)
    expect(res.hits[0].row.raw.project).toBe('Marina Lumen')
  })
})

describe('engine rules', () => {
  it('a blank yes/no cell is never read as a match or a miss: it comes after sure rows, marked unsure', () => {
    const res = run(units.rows, units.schema, { filters: [{ key: 'pets', op: 'is', value: true }] })
    const firstMaybe = res.hits.findIndex(h => h.unsure.length > 0)
    expect(firstMaybe).toBe(res.total)
    for (const h of res.hits.slice(res.total)) expect(h.row.values.pets).toBeNull()
  })

  it('never loosens a "no nuts" exclusion', () => {
    const q: Query = {
      filters: [
        { key: 'allergens', op: 'lacks', values: ['nuts'] },
        { key: 'section', op: 'in', values: ['Desserts'] },
        { key: 'price', op: 'range', max: 20 },
      ],
    }
    const res = run(menu.rows, menu.schema, q)
    for (const h of res.hits) expect((h.row.values.allergens as string[] | null)?.includes('nuts')).not.toBe(true)
  })

  it('area widens to neighbours before beds change', () => {
    const csv = 'Project,Unit,Area,Bedrooms,Price (AED)\nA,1,JLT,1,1M\nB,2,Dubai Marina,4,3M\nC,3,JLT,3,2M\n'
    const s = loadCsv(csv, units.schema)
    const res = run(s.rows, s.schema, {
      filters: [
        { key: 'area', op: 'in', values: ['JLT'] },
        { key: 'beds', op: 'range', min: 4, max: 4 },
      ],
    })
    expect(res.relaxed?.keys).toEqual(['area'])
    expect(res.hits.map(h => h.row.raw.project)).toEqual(['B'])
  })

  it('compare lists only fields that differ', () => {
    const [a, b] = units.rows
    const d = diffRows(a, b, units.schema)
    for (const x of d) expect(a.raw[x.key]).not.toBe(b.raw[x.key])
  })

  it('a later one-sided limit keeps the other side', () => {
    const q = applyPatch({ filters: [{ key: 'price', op: 'range', max: 2_500_000 }] }, { set: [{ key: 'price', op: 'range', min: 2_000_000 }], remove: [] })
    expect(q.filters).toEqual([{ key: 'price', op: 'range', min: 2_000_000, max: 2_500_000 }])
  })
})

// Property tests: random filters over the real Dubai rows.
const AREAS = ['Dubai Marina', 'JVC', 'Downtown', 'Business Bay', 'JLT', 'Palm Jumeirah', 'Dubai Hills', 'Creek Harbour', 'Arjan', 'Al Furjan']
const VIEWS = ['Sea', 'Marina', 'Burj', 'Golf', 'Park', 'Canal', 'Creek', 'Pool', 'Community', 'City', 'Lake']
const filterArb: fc.Arbitrary<Filter> = fc.oneof(
  fc.integer({ min: 0, max: 4 }).map(n => ({ key: 'beds', op: 'range' as const, min: n, max: n })),
  fc.integer({ min: 4, max: 120 }).map(n => ({ key: 'price', op: 'range' as const, max: n * 100_000 })),
  fc.integer({ min: 4, max: 60 }).map(n => ({ key: 'price', op: 'range' as const, min: n * 100_000 })),
  fc.subarray(AREAS, { minLength: 1, maxLength: 3 }).map(v => ({ key: 'area', op: 'in' as const, values: v })),
  fc.subarray(VIEWS, { minLength: 1, maxLength: 2 }).map(v => ({ key: 'view', op: 'in' as const, values: v })),
  fc.subarray(AREAS, { minLength: 1, maxLength: 2 }).map(v => ({ key: 'area', op: 'not_in' as const, values: v })),
  fc.boolean().map(b => ({ key: 'pets', op: 'is' as const, value: b })),
  fc.boolean().map(b => ({ key: 'furnished', op: 'is' as const, value: b })),
  fc.integer({ min: 0, max: 2029 * 12 }).map(n => ({ key: 'handover', op: 'range' as const, max: n })),
)
const queryArb = fc.uniqueArray(filterArb, { maxLength: 5, selector: f => `${f.key}:${f.op}` }).map(filters => ({ filters }))

describe('engine properties (1,000 random queries)', () => {
  it('every sure row passes every filter used; every maybe row fails none', () => {
    fc.assert(
      fc.property(queryArb, q => {
        const res = run(units.rows, units.schema, q)
        const used = res.relaxed ? res.relaxed.filters : q.filters
        res.hits.forEach((h, i) => {
          const unsure = check(h.row, used)
          expect(unsure).not.toBeNull()
          if (i < res.total) expect(unsure).toEqual([])
          else expect(unsure!.length).toBeGreaterThan(0)
        })
      }),
      { numRuns: 1000 },
    )
  })

  it('counts equal a brute-force count when nothing is relaxed', () => {
    fc.assert(
      fc.property(queryArb, q => {
        const res = run(units.rows, units.schema, q)
        if (res.relaxed) return
        const sure = units.rows.filter(r => check(r, q.filters)?.length === 0).length
        const maybe = units.rows.filter(r => (check(r, q.filters)?.length ?? 0) > 0).length
        expect(res.total).toBe(sure)
        expect(res.maybe).toBe(maybe)
      }),
      { numRuns: 1000 },
    )
  })

  it('relaxes only when the strict query finds nothing, and always says so', () => {
    fc.assert(
      fc.property(queryArb, q => {
        const res = run(units.rows, units.schema, q)
        const strict = units.rows.filter(r => check(r, q.filters) !== null).length
        if (strict > 0) expect(res.relaxed).toBeUndefined()
        else if (res.hits.length) expect(res.relaxed?.keys.length).toBeGreaterThan(0)
      }),
      { numRuns: 1000 },
    )
  })

  it('ordering is stable: same query, same rows in the same order', () => {
    fc.assert(
      fc.property(queryArb, q => {
        const a = run(units.rows, units.schema, q).hits.map(h => h.row.r)
        const b = run([...units.rows].reverse(), units.schema, q).hits.map(h => h.row.r)
        expect(b).toEqual(a)
      }),
      { numRuns: 300 },
    )
  })
})
