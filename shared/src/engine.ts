// The filter engine. Pure functions over typed rows. Every row it returns
// satisfies every filter that was not relaxed, and a relaxation is always
// reported so the lens can say what changed.

import type { Cell, Filter, Hit, Query, Relaxation, Result, Row, Schema, SortSpec, Verdict } from './types'
import { formatMoney } from './normalize'
import { column } from './sheet'

export function test(cell: Cell, f: Filter): Verdict {
  if (cell == null) return 'unknown'
  switch (f.op) {
    case 'range': {
      if (typeof cell !== 'number') return 'unknown'
      if (f.min != null && cell < f.min) return 'no'
      if (f.max != null && cell > f.max) return 'no'
      return 'yes'
    }
    case 'in':
      return f.values.includes(String(cell)) ? 'yes' : 'no'
    case 'not_in':
      return f.values.includes(String(cell)) ? 'no' : 'yes'
    case 'is':
      return cell === f.value ? 'yes' : 'no'
    case 'lacks':
      return Array.isArray(cell) && f.values.some(v => cell.includes(v)) ? 'no' : 'yes'
    case 'has':
      return Array.isArray(cell) && f.values.every(v => cell.includes(v)) ? 'yes' : 'no'
    case 'text': {
      const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
      const hay = String(cell).toLowerCase()
      return words.every(w => hay.includes(w)) ? 'yes' : 'no'
    }
  }
}

/** Returns null when the row fails a filter, or the keys that were blank. */
export function check(row: Row, filters: Filter[]): string[] | null {
  const unsure: string[] = []
  for (const f of filters) {
    const v = test(row.values[f.key], f)
    if (v === 'no') return null
    if (v === 'unknown') unsure.push(f.key)
  }
  return unsure
}

function compare(a: Row, b: Row, sort: SortSpec): number {
  const av = a.values[sort.key]
  const bv = b.values[sort.key]
  if (av == null && bv == null) return a.r - b.r
  if (av == null) return 1
  if (bv == null) return -1
  const d = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
  if (d !== 0) return sort.dir === 'asc' ? d : -d
  return a.r - b.r
}

function select(rows: Row[], filters: Filter[], sort: SortSpec): { sure: Hit[]; maybe: Hit[] } {
  const sure: Hit[] = []
  const maybe: Hit[] = []
  for (const row of rows) {
    const unsure = check(row, filters)
    if (!unsure) continue
    ;(unsure.length ? maybe : sure).push({ row, unsure })
  }
  const by = (x: Hit, y: Hit) => compare(x.row, y.row, sort)
  sure.sort(by)
  maybe.sort(by)
  return { sure, maybe }
}

/** One step down the relaxation ladder for a single filter, or null if it cannot relax. */
export function relaxFilter(f: Filter, schema: Schema): { replacement: Filter | null; sort?: SortSpec } | null {
  const col = column(schema, f.key)
  switch (f.op) {
    case 'is':
    case 'has':
    case 'text':
      return { replacement: null }
    case 'in': {
      if (col.type !== 'category' || !col.neighbours) return { replacement: null }
      const extra = f.values.flatMap(v => col.neighbours?.[v] ?? [])
      const values = [...new Set([...f.values, ...extra])]
      if (values.length === f.values.length) return null
      return { replacement: { ...f, values } }
    }
    case 'range': {
      if (col.type === 'int' && f.min != null && f.max != null && f.min === f.max) {
        return { replacement: { key: f.key, op: 'range', min: Math.max(0, f.min - 1), max: f.max + 1 } }
      }
      // Budget-style limits: drop the limit and sort toward it, so the first
      // row is the nearest one on the wrong side.
      if (f.max != null && f.min == null) return { replacement: null, sort: { key: f.key, dir: 'asc' } }
      if (f.min != null && f.max == null) return { replacement: null, sort: { key: f.key, dir: 'desc' } }
      return { replacement: null }
    }
    case 'not_in':
    case 'lacks':
      // Never relax a safety exclusion ("no nuts") or an explicit "not".
      return null
  }
}

export function describeFilter(f: Filter, schema: Schema): string {
  const col = column(schema, f.key)
  switch (f.op) {
    case 'range': {
      const fmt = (n: number) => (col.type === 'money' ? formatMoney(n) : String(n))
      if (col.key === 'beds' || col.label === 'BR') {
        if (f.min != null && f.min === f.max) return f.min === 0 ? 'studio' : `${f.min}BR`
        if (f.min != null && f.max == null) return `${f.min}+BR`
      }
      if (f.min != null && f.max != null) return f.min === f.max ? `${col.label ?? col.key} ${fmt(f.min)}` : `${fmt(f.min)}-${fmt(f.max)}`
      if (f.max != null) return `<=${fmt(f.max)}${col.unitWords ? ' ' + col.unitWords[0] : ''}`
      return `>=${fmt(f.min!)}${col.unitWords ? ' ' + col.unitWords[0] : ''}`
    }
    case 'in':
      return f.values.map(short).join('/')
    case 'not_in':
      return `not ${f.values.map(short).join('/')}`
    case 'is':
      return f.value ? (col.label ?? col.key) : `no ${col.label ?? col.key}`
    case 'lacks':
      return `no ${f.values.join('/')}`
    case 'has':
      return `has ${f.values.join('/')}`
    case 'text':
      return `"${f.q}"`
  }
}

function short(v: string): string {
  return v.replace(/^Dubai /, '').replace(/ Jumeirah$/, '').replace(/ Harbour$/, '')
}

function easedLabel(f: Filter, schema: Schema): string {
  if (f.key === schema.priceKey) return 'budget'
  if (f.op === 'in' && column(schema, f.key).neighbours) return 'nearby areas'
  return describeFilter(f, schema)
}

/**
 * Runs a query. When nothing matches (sure or maybe), walks the schema's
 * relaxation ladder, loosening one more filter at each step and keeping the
 * earlier ones loosened, and returns the first non-empty result. Safety
 * exclusions ("no nuts") are never loosened.
 */
export function run(rows: Row[], schema: Schema, q: Query): Result {
  const sort = q.sort ?? schema.defaultSort
  const strict = select(rows, q.filters, sort)
  if (strict.sure.length || strict.maybe.length) {
    return { hits: [...strict.sure, ...strict.maybe], total: strict.sure.length, maybe: strict.maybe.length }
  }

  const order = [...q.filters].sort((a, b) => rank(schema, a.key) - rank(schema, b.key))
  let filters = [...q.filters]
  let relaxSort: SortSpec | undefined
  const keys: string[] = []
  const eased: string[] = []
  for (const f of order) {
    const step = relaxFilter(f, schema)
    if (!step) continue
    filters = filters.map(x => (x === f ? step.replacement : x)).filter((x): x is Filter => x != null)
    relaxSort = step.sort ?? relaxSort
    keys.push(f.key)
    eased.push(easedLabel(f, schema))
    const res = select(rows, filters, relaxSort ?? sort)
    if (res.sure.length || res.maybe.length) {
      const relaxed: Relaxation = {
        keys,
        note: `none: ${q.filters.map(x => describeFilter(x, schema)).join(' | ')}`,
        eased: `eased: ${eased.join(', ')}`,
        filters,
      }
      return { hits: [...res.sure, ...res.maybe], total: res.sure.length, maybe: res.maybe.length, relaxed }
    }
  }
  return { hits: [], total: 0, maybe: 0 }
}

function rank(schema: Schema, key: string): number {
  const i = schema.relaxOrder.indexOf(key)
  return i < 0 ? schema.relaxOrder.length : i
}

/** Applies a parser patch to the session's current filters. */
export function applyPatch(current: Query, patch: { set: Filter[]; remove: string[]; clear?: boolean; sort?: SortSpec }): Query {
  let filters = patch.clear ? [] : current.filters.filter(f => !patch.remove.includes(f.key))
  for (const f of patch.set) {
    const old = filters.find(x => x.key === f.key && family(x) === family(f))
    filters = filters.filter(x => x !== old)
    // A new one-sided limit keeps the other side of an existing range
    // ("under 2.5M" then "at least 2M" gives 2M to 2.5M).
    if (old?.op === 'range' && f.op === 'range' && (f.min == null || f.max == null)) {
      filters.push({ key: f.key, op: 'range', min: f.min ?? old.min, max: f.max ?? old.max })
    } else filters.push(f)
  }
  return { filters, sort: patch.clear ? patch.sort : (patch.sort ?? current.sort) }
}

/** "in" and "not_in" on the same key replace each other; so do "lacks" and "has". */
function family(f: Filter): string {
  if (f.op === 'in' || f.op === 'not_in') return 'cat'
  if (f.op === 'lacks' || f.op === 'has') return 'list'
  return f.op
}

/** Short reason for the top row, built from its fields: "150k under budget". */
export function whyLine(hit: Hit, schema: Schema, q: Query): string {
  const parts: string[] = []
  const pk = schema.priceKey
  const budget = q.filters.find((f): f is Extract<Filter, { op: 'range' }> => f.op === 'range' && f.key === pk && f.max != null)
  const price = pk ? hit.row.values[pk] : null
  if (budget && typeof price === 'number') {
    const diff = budget.max! - price
    parts.push(diff >= 0 ? `${formatMoney(diff)} under budget` : `${formatMoney(-diff)} over budget`)
  }
  if (hit.unsure.length) parts.push(`${hit.unsure.join(', ')} not in sheet`)
  return parts.join(', ')
}

/** Fields that differ between two rows, for "compare 1 and 2". */
export function diffRows(a: Row, b: Row, schema: Schema): { key: string; a: string; b: string }[] {
  return schema.detail
    .filter(k => a.raw[k] !== b.raw[k])
    .map(k => ({ key: k, a: a.raw[k] || '-', b: b.raw[k] || '-' }))
}
