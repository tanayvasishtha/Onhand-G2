import { describe, expect, it } from 'vitest'
import { applyPatch, run } from '../src/engine'
import { inferSchema } from '../src/infer'
import { describePatch } from '../eval/format'
import { resultsScreen } from '../src/lens'
import { parse } from '../src/parse'
import { loadSheet, parseCsv } from '../src/sheet'

const furniture = `Item,Category,Colour,Material,Price (AED),Width (cm),In stock,Delivery
Oslo three-seater,Sofa,Grey,Fabric,"AED 3,200",210,Yes,Next week
Oslo corner sofa,Sofa,Grey,Fabric,"AED 4,850",280,No,6 weeks
Milan two-seater,Sofa,Tan,Leather,"AED 5,400",180,Yes,Next week
Milan armchair,Armchair,Tan,Leather,"AED 2,100",90,Yes,In store
Nord dining table,Table,Oak,Wood,"AED 2,750",160,Yes,In store
Nord coffee table,Table,Walnut,Wood,"AED 1,200",110,No,4 weeks
Cove bed frame,Bed,White,Wood,"AED 3,900",180,Yes,2 weeks
Cove bedside,Storage,White,Wood,AED 650,45,Yes,In store
Lumen sofa bed,Sofa,Blue,Fabric,"AED 2,950",200,Yes,2 weeks
Aria lounge chair,Armchair,Green,Velvet,"AED 1,850",80,,2 weeks
Aria ottoman,Storage,Green,Velvet,AED 700,60,Yes,In store
Halden sideboard,Storage,Oak,Wood,"AED 3,300",190,Yes,Next week`

const candidates = `Name,Role,City,Years,Notice (days),Expected salary (INR),Skills,Remote
Aarav Mehta,Backend engineer,Bengaluru,5,30,"₹28,00,000","Go, Postgres, Kafka",Yes
Diya Rao,Frontend engineer,Pune,3,60,"₹18,00,000","React, TypeScript",No
Kabir Singh,Data engineer,Gurugram,7,90,"₹36,00,000","Python, Spark, Kafka",Yes
Meera Iyer,Backend engineer,Chennai,4,15,"₹24,00,000","Java, Postgres",Yes
Rohan Das,Frontend engineer,Bengaluru,6,30,"₹30,00,000","React, Next.js, TypeScript",Yes
Sara Khan,Data engineer,Mumbai,2,0,"₹14,00,000","Python, SQL",No
Ishaan Gupta,Backend engineer,Gurugram,8,60,"₹42,00,000","Go, Kafka, AWS",No
Ananya Bose,Product designer,Kolkata,5,30,"₹22,00,000","Figma, Research",Yes`

function sheetOf(csv: string, name: string) {
  const grid = parseCsv(csv)
  return loadSheet(grid, inferSchema(grid, `inferred-${name}`, name))
}

describe('schema inference for a sheet Onhand has never seen', () => {
  const shop = sheetOf(furniture, 'Showroom')
  const types = Object.fromEntries(shop.schema.columns.map(c => [c.key, c.type]))

  it('works out column types from the values', () => {
    expect(types).toMatchObject({ item: 'text', category: 'category', colour: 'category', material: 'category', price_aed: 'money', width_cm: 'int', in_stock: 'bool' })
    expect(shop.schema.titleKey).toBe('item')
    expect(shop.schema.priceKey).toBe('price_aed')
    expect(shop.rows).toHaveLength(12)
  })

  it('answers spoken requests with the same parser and engine', () => {
    const p = parse('a grey sofa under 4000 that is in stock', shop)
    expect(describePatch(p)).toEqual(['category Sofa', 'colour Grey', 'in_stock yes', 'price_aed ..4000'])
    const res = run(shop.rows, shop.schema, applyPatch({ filters: [] }, p))
    expect(res.hits.map(h => h.row.raw.item)).toEqual(['Oslo three-seater'])
  })

  it('handles negation and units from the header', () => {
    expect(describePatch(parse('anything but fabric, under 200 cm', shop))).toEqual(['material not_in Fabric', 'width_cm ..200'])
  })

  it('reads a recruiter sheet with lists, rupees and counts', () => {
    const people = sheetOf(candidates, 'Candidates')
    const t = Object.fromEntries(people.schema.columns.map(c => [c.key, c.type]))
    expect(t).toMatchObject({ name: 'text', role: 'category', city: 'category', years: 'int', expected_salary_inr: 'money', skills: 'list', remote: 'bool' })
    const p = parse('backend engineer who knows kafka, under 30 lakh, remote', people)
    expect(describePatch(p)).toEqual(['expected_salary_inr ..3000000', 'remote yes', 'role Backend engineer', 'skills has Kafka'])
    const res = run(people.rows, people.schema, applyPatch({ filters: [] }, p))
    expect(res.hits.map(h => h.row.raw.name)).toEqual(['Aarav Mehta'])
  })

  it('renders inferred sheets within the lens limits', () => {
    const res = run(shop.rows, shop.schema, { filters: [{ key: 'category', op: 'in', values: ['Sofa'] }] })
    const screen = resultsScreen({ sheet: shop, query: { filters: [{ key: 'category', op: 'in', values: ['Sofa'] }] }, result: res, highlight: 0, shortlist: new Set(), listening: false, heard: '' })
    expect(screen.split('\n').length).toBeLessThanOrEqual(8)
    expect(screen).toContain('Oslo three-seater')
  })
})

describe('spelling variants from speech-to-text', () => {
  it('matches "gray" to a sheet that says Grey', () => {
    const grid = parseCsv(furniture)
    const shop = loadSheet(grid, inferSchema(grid, 'x', 'Showroom'))
    expect(describePatch(parse("A gray sofa under 4,000 that's in stock.", shop))).toEqual(['category Sofa', 'colour Grey', 'in_stock yes', 'price_aed ..4000'])
  })
})
