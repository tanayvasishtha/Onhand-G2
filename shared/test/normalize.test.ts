import { describe, expect, it } from 'vitest'
import { formatMoney, formatMonth, parseBool, parseCount, parseList, parseMoney, parseMonth, parseNumber, aliasIndex, READY } from '../src/normalize'

describe('parseMoney', () => {
  it.each([
    ['2.5M', 2_500_000],
    ['2,500,000', 2_500_000],
    ['AED 2.5m', 2_500_000],
    ['AED 2,350,000', 2_350_000],
    ['2.35 mn', 2_350_000],
    ['2.5 million', 2_500_000],
    ['2350000', 2_350_000],
    ['850k', 850_000],
    ['850K', 850_000],
    ['92.5k', 92_500],
    ['25 lakh', 2_500_000],
    ['1.2 Cr', 12_000_000],
    ['1.2 crore', 12_000_000],
    ['₹25,00,000', 2_500_000],
    ['$680,000', 680_000],
    ['68', 68],
    ['68.00', 68],
    ['AED 84,500', 84_500],
    ['Dhs 1.1m', 1_100_000],
  ])('%s -> %d', (input, want) => expect(parseMoney(input)).toBe(want))

  it.each(['', 'TBC', 'call', 'on request', '  ', 'price on request', '2.5 apples'])('%s is unreadable', input =>
    expect(parseMoney(input)).toBeNull(),
  )
})

describe('parseCount', () => {
  it.each([
    ['Studio', 0],
    ['studio', 0],
    ['2BR', 2],
    ['2 Bed', 2],
    ['2', 2],
    ['2 B/R', 2],
    ['3BR + Maid', 3],
    ['4+', 4],
    ['1 Bedroom', 1],
  ])('%s -> %d', (input, want) => expect(parseCount(input)).toBe(want))
  it('blank is unknown', () => expect(parseCount('')).toBeNull())
})

describe('parseBool', () => {
  it.each([
    ['Yes', true],
    ['yes', true],
    ['Y', true],
    ['true', true],
    ['✓', true],
    ['allowed', true],
    ['No', false],
    ['n', false],
    ['false', false],
    ['not allowed', false],
    ['✗', false],
  ])('%s -> %s', (input, want) => expect(parseBool(input)).toBe(want))
  it.each(['', ' ', 'maybe', 'ask owner'])('%s is unknown, never false', input => expect(parseBool(input)).toBeNull())
})

describe('parseMonth', () => {
  const m = (y: number, mo: number) => y * 12 + mo - 1
  it.each([
    ['Ready', READY],
    ['ready', READY],
    ['Completed', READY],
    ['Q3 2026', m(2026, 9)],
    ['Q3-26', m(2026, 9)],
    ['Q1 2027', m(2027, 3)],
    ['q4/28', m(2028, 12)],
    ['Dec 2027', m(2027, 12)],
    ['December 2027', m(2027, 12)],
    ['Sep 2026', m(2026, 9)],
    ['12/2027', m(2027, 12)],
    ['2028', m(2028, 12)],
  ])('%s', (input, want) => expect(parseMonth(input)).toBe(want))
  it('unreadable is unknown', () => expect(parseMonth('soon')).toBeNull())
  it('round-trips to a quarter label', () => {
    expect(formatMonth(parseMonth('Sep 2026'))).toBe('Q3-26')
    expect(formatMonth(parseMonth('Ready'))).toBe('ready')
    expect(formatMonth(null)).toBe('?')
  })
})

describe('parseNumber', () => {
  it.each([
    ['1,250', 1250],
    ['1180 sqft', 1180],
    ['1,180 sq ft', 1180],
    ['45,000 km', 45000],
    ['61200', 61200],
    ['45k km', 45000],
  ])('%s -> %d', (input, want) => expect(parseNumber(input)).toBe(want))
})

describe('parseList', () => {
  const idx = aliasIndex({ nuts: ['pine nuts', 'walnuts', 'pistachio'], dairy: ['milk', 'cheese'], gluten: ['wheat'] })
  it('maps aliases to the family and keeps unknown items', () => {
    expect(parseList('Pine nuts, dairy', idx)).toEqual(['nuts', 'dairy'])
    expect(parseList('gluten; Milk; celery', idx)).toEqual(['gluten', 'dairy', 'celery'])
  })
  it('"None" is an empty list, blank is unknown', () => {
    expect(parseList('None', idx)).toEqual([])
    expect(parseList('-', idx)).toEqual([])
    expect(parseList('', idx)).toBeNull()
  })
})

describe('formatMoney', () => {
  it.each([
    [2_350_000, '2.35M'],
    [2_500_000, '2.5M'],
    [850_000, '850k'],
    [92_500, '92.5k'],
    [68, '68'],
  ])('%d -> %s', (n, want) => expect(formatMoney(n)).toBe(want))
})
