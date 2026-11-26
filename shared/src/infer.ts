// Works out a schema for a sheet Onhand has never seen: column types from the
// values, spoken names from the headers, and which column names each row. The
// parser, engine and lens then run on it unchanged. A hand-written schema for a
// known layout still wins, because it carries synonyms and neighbours.

import { normText, parseBool, parseMoney, parseMonth, parseNumber } from './normalize'
import type { CardField, Column, ColType, Schema } from './types'

const MONEY_HEADER = /\b(price|cost|rent|rate|fee|budget|amount|aed|usd|inr|eur|gbp|value|salary|ctc|mrp)\b|[$€£₹]/i
const DATE_HEADER = /\b(date|handover|completion|available|availability|from|until|deadline|due|start|end|delivery|ready)\b/i
const SIZE_HEADER = /\b(size|sqft|sq ft|square|area \(|capacity|seats|weight|kg|litres|liters)\b/i
const UNIT_IN_HEADER = /\(([^)]+)\)\s*$/
const CURRENCY_UNITS = new Set(['aed', 'usd', 'inr', 'eur', 'gbp', '$', '€', '£', '₹'])

const share = (vals: string[], ok: (v: string) => boolean) => (vals.length ? vals.filter(ok).length / vals.length : 0)

/** Lower-case key from a header: "Price (AED)" -> "price_aed". Unique within the sheet. */
function keyFor(header: string, used: Set<string>): string {
  let base = normText(header).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'col'
  if (/^\d/.test(base)) base = `c_${base}`
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}_${i}`
  used.add(key)
  return key
}

/** Words a person would say for this column: the header without its unit, singular and plural. */
function spokenNames(header: string): string[] {
  const words = normText(header.replace(UNIT_IN_HEADER, '')).replace(/[^a-z0-9 /]+/g, ' ').trim()
  if (!words) return []
  const out = new Set([words])
  for (const w of words.split(/\s+/)) {
    if (w.length < 3) continue
    out.add(w)
    out.add(w.endsWith('s') ? w.slice(0, -1) : `${w}s`)
  }
  return [...out]
}

function typeOf(header: string, vals: string[], rows: number): ColType {
  if (!vals.length) return 'text'
  const distinct = new Set(vals.map(v => normText(v)))
  const unit = header.match(UNIT_IN_HEADER)?.[1]?.trim().toLowerCase()
  if (share(vals, v => parseBool(v) != null) >= 0.9 && distinct.size <= 6) return 'bool'
  if ((MONEY_HEADER.test(header) || (unit && CURRENCY_UNITS.has(unit))) && share(vals, v => parseMoney(v) != null) >= 0.8) return 'money'
  if (DATE_HEADER.test(header) && share(vals, v => parseMonth(v) != null) >= 0.8) return 'date'
  if (share(vals, v => /[$€£₹]|\baed\b|\busd\b/i.test(v)) >= 0.5 && share(vals, v => parseMoney(v) != null) >= 0.8) return 'money'
  const numeric = share(vals, v => parseNumber(v) != null && /^\D{0,4}[\d.,]+\s*[a-z]{0,6}\.?$/i.test(v.trim()))
  if (numeric >= 0.9) {
    const nums = vals.map(v => parseNumber(v)!).filter(n => n != null)
    const whole = nums.every(n => Number.isInteger(n))
    return whole && Math.max(...nums) < 1000 && distinct.size <= 40 ? 'int' : 'number'
  }
  // A list: most cells hold several comma-separated items that repeat across rows.
  const multi = share(vals, v => v.includes(','))
  if (multi >= 0.3) {
    const items = vals.flatMap(v => v.split(/[,;/]/).map(x => normText(x)).filter(Boolean))
    if (new Set(items).size <= Math.max(25, rows * 0.2)) return 'list'
  }
  if (distinct.size <= Math.max(12, rows * 0.15) && share(vals, v => v.length <= 40) >= 0.95) return 'category'
  return 'text'
}

/**
 * Infers a schema from the header row and the body. `id` and `name` label it
 * on the lens. Columns that are empty in every row are kept as text so their
 * raw value still shows on the detail screen.
 */
export function inferSchema(grid: string[][], id: string, name: string): Schema {
  const [header, ...body] = grid
  const rows = body.filter(r => r.some(c => c.trim()))
  const used = new Set<string>()
  const columns: Column[] = header.map((h, i) => {
    const vals = rows.map(r => (r[i] ?? '').trim()).filter(Boolean)
    const type = typeOf(h, vals, rows.length)
    const col: Column = { key: keyFor(h, used), header: h.trim(), type, synonyms: spokenNames(h) }
    const unit = h.match(UNIT_IN_HEADER)?.[1]?.trim().toLowerCase()
    if ((type === 'number' || type === 'int') && unit && !CURRENCY_UNITS.has(unit)) col.unitWords = [unit]
    if (type === 'category') {
      const canon = new Map<string, string>()
      for (const v of vals) if (!canon.has(normText(v))) canon.set(normText(v), v)
      col.values = Object.fromEntries([...canon.values()].map(v => [v, [normText(v)]]))
    }
    if (type === 'list') {
      const canon = new Map<string, string>()
      for (const v of vals) for (const item of v.split(/[,;/]/).map(x => x.trim()).filter(Boolean)) if (!canon.has(normText(item))) canon.set(normText(item), item)
      col.values = Object.fromEntries([...canon.values()].map(v => [v, [normText(v)]]))
    }
    if (type === 'bool') col.label = spokenNames(h)[0]?.split(' ')[0]
    return col
  })

  // The row's name: the text column with the most distinct values, else the first column.
  const textCols = columns.map((c, i) => ({ c, i })).filter(x => x.c.type === 'text')
  const distinctOf = (i: number) => new Set(rows.map(r => normText(r[i] ?? ''))).size
  const title = textCols.sort((a, b) => distinctOf(b.i) - distinctOf(a.i) || a.i - b.i)[0]?.c ?? columns[0]
  if (title.type !== 'text') title.type = 'text'

  const price = columns.find(c => c.type === 'money')
  const size = columns.find(c => (c.type === 'number' || c.type === 'int') && SIZE_HEADER.test(c.header))
  const card: CardField[] = [{ key: title.key, maxChars: 18 }]
  for (const c of columns) {
    if (card.length >= 4) break
    if (c === title) continue
    if (c.type === 'money' || c.type === 'category' || c.type === 'date' || c.type === 'int') card.push({ key: c.key })
  }
  const relaxOrder = [
    ...columns.filter(c => c.type === 'bool'),
    ...columns.filter(c => c.type === 'category' && c !== title),
    ...columns.filter(c => c.type === 'money'),
    ...columns.filter(c => c.type === 'date'),
    ...columns.filter(c => c.type === 'number' || c.type === 'int'),
  ].map(c => c.key)

  return {
    id,
    name,
    source: `Columns worked out from the sheet "${name}".`,
    columns,
    titleKey: title.key,
    requiredKeys: [title.key],
    card,
    detail: columns.filter(c => c !== title).map(c => c.key).slice(0, 10),
    defaultSort: price ? { key: price.key, dir: 'asc' } : { key: title.key, dir: 'asc' },
    relaxOrder,
    priceKey: price?.key,
    sizeKey: size?.key,
  }
}
