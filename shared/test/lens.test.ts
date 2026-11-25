import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { run } from '../src/engine'
import { parse } from '../src/parse'
import { applyPatch } from '../src/engine'
import {
  compareScreen,
  detailScreen,
  estimateWidth,
  LINE_PX,
  listeningScreen,
  MAX_LINES,
  readyScreen,
  recapScreen,
  resultsScreen,
  SAFE_GLYPHS,
  safe,
  type ViewState,
} from '../src/lens'
import type { Query, Sheet } from '../src/types'
import { cars, menu, units } from './fixtures'

function state(sheet: Sheet, query: Query, highlight = 0): ViewState {
  const result = run(sheet.rows, sheet.schema, query)
  const shortlist = new Set(result.hits.slice(0, 2).map(h => h.row.r))
  return { sheet, query, result, highlight: Math.min(highlight, Math.max(0, result.hits.length - 1)), shortlist, listening: false, heard: '' }
}

function assertScreen(text: string) {
  const lines = text.split('\n')
  expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
  expect(text).toMatch(SAFE_GLYPHS)
  for (const l of lines) expect(estimateWidth(l)).toBeLessThanOrEqual(LINE_PX)
}

const REQUESTS: [Sheet, string][] = [
  [units, 'two bed in Marina under two and a half million with a sea view'],
  [units, '3 bedrooms in Marina under 2 million'],
  [units, 'studio in JVC under 600k pet friendly furnished ready to move in'],
  [units, 'anything but downtown, 4 bed or more, golf view, off plan, under 900k'],
  [menu, 'does the risotto have nuts?'],
  [menu, 'something vegan with no nuts and no gluten'],
  [cars, 'a white SUV under 90k'],
  [cars, '2022 or newer under 50000 km hybrid'],
]

describe('every screen fits the lens', () => {
  it.each(REQUESTS)('%#: results, detail, compare for "%s"', (sheet, text) => {
    const q = applyPatch({ filters: [] }, parse(text, sheet))
    for (const hl of [0, 1, 5]) {
      const s = state(sheet, q, hl)
      assertScreen(resultsScreen(s))
      assertScreen(detailScreen(s))
      assertScreen(compareScreen(s, 0, 1))
      assertScreen(recapScreen(s, 3, 'Draft ready | Lead saved r302'))
      assertScreen(listeningScreen({ ...s, listening: true, heard: text }))
    }
    assertScreen(readyScreen(state(sheet, { filters: [] })))
  })

  it('random queries never break the layout', () => {
    const words = ['2 bed', 'studio', 'marina', 'jvc', 'under 2M', 'over 5M', 'sea view', 'pets', 'no pets', 'furnished', 'ready', 'off plan', 'golf', 'downtown', 'between 1 and 3 million', 'cheapest', 'biggest']
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...words), { maxLength: 6 }), fc.nat(10), (ws, hl) => {
        const q = applyPatch({ filters: [] }, parse(ws.join(' '), units))
        const s = state(units, q, hl)
        assertScreen(resultsScreen(s))
        assertScreen(detailScreen(s))
      }),
      { numRuns: 300 },
    )
  })

  it('the hero screen reads as designed', () => {
    const q = applyPatch({ filters: [] }, parse('two bed in Marina under two and a half million with a sea view', units))
    const text = resultsScreen({ ...state(units, q), shortlist: new Set() })
    const [head, first] = text.split('\n')
    expect(head).toMatch(/^○ 2BR \| Marina \| <=2.5M \| Sea +\d+ match$/)
    expect(first).toMatch(/^▶ 1 .+ #\d{4} \d\.\d+M (ready|Q\d-\d\d) r\d+$/)
  })

  it('a no-match screen names what found nothing and what was eased', () => {
    const q = applyPatch({ filters: [] }, parse('3 bedrooms in Marina under 2 million', units))
    const lines = resultsScreen(state(units, q)).split('\n')
    expect(lines[0]).toBe('○ none: 3BR | Marina | <=2M')
    expect(lines[1]).toBe('nearest, eased: budget')
    expect(lines[2]).toContain('2.18M')
  })

  it('safe() replaces glyphs the firmware font would drop', () => {
    expect(safe('2BR · Marina ≤2.5M … “sea” — ok ₹')).toBe('2BR | Marina <=2.5M .. "sea" - ok ')
  })
})
