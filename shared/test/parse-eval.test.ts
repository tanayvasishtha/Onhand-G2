import { describe, expect, it } from 'vitest'
import cases from '../eval/cases.json'
import { describePatch } from '../eval/format'
import { parse } from '../src/parse'
import { cars, menu, units } from './fixtures'

const sheets = { 'dubai-units': units, 'restaurant-menu': menu, 'car-stock': cars } as const

describe('parser eval (80 meeting requests, reviewed by hand)', () => {
  for (const c of cases) {
    it(`${c.sheet}: ${c.text}`, () => {
      const p = parse(c.text, sheets[c.sheet as keyof typeof sheets])
      expect(describePatch(p)).toEqual(c.expect)
      expect(p.unparsed).toBe(c.unparsed)
    })
  }
})
