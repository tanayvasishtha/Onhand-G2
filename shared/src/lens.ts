// Text screens for the 576x288 lens. One text container, 8 lines at most, and
// only glyphs the firmware font is known to draw.

import type { Hit, Query, Result, Row, Schema, Sheet } from './types'
import { describeFilter, diffRows, whyLine } from './engine'
import { formatMoney, formatMonth } from './normalize'
import { column } from './sheet'

export const MAX_LINES = 8
/** Usable width in pixels: 576 minus container padding on both sides. */
export const LINE_PX = 560
export const SAFE_GLYPHS = /^[\x20-\x7E●○★☆▶━─│\n]*$/

// Rough widths for the proportional firmware font. Calibrated against
// simulator screenshots; conservative on purpose.
const NARROW = new Set("il.,:;'|!1 ()[]")
const WIDE = new Set('MWmw@%')
export function estimateWidth(line: string): number {
  let px = 0
  for (const ch of line) {
    if (NARROW.has(ch)) px += 7
    else if (WIDE.has(ch)) px += 17
    else if (/[A-Z0-9#]/.test(ch)) px += 13
    else if (/[a-z<=>\-+/*?"$&_]/.test(ch)) px += 11
    else px += 16
  }
  return px
}

/** Cuts a line so it fits the lens width. */
export function fit(line: string, maxPx = LINE_PX): string {
  if (estimateWidth(line) <= maxPx) return line
  let out = line
  while (out.length > 1 && estimateWidth(out + '..') > maxPx) out = out.slice(0, -1)
  return out.trimEnd() + '..'
}

/** Strips anything outside the safe glyph set, so the font never drops characters silently. */
export function safe(text: string): string {
  return text
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '..')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/·/g, '|')
    .replace(/[^\x20-\x7E●○★☆▶━─│\n]/g, '')
}

export function formatCell(row: Row, key: string, schema: Schema): string {
  const col = column(schema, key)
  const v = row.values[key]
  if (v == null) return row.raw[key] ? row.raw[key] : '?'
  switch (col.type) {
    case 'money':
      return formatMoney(v as number)
    case 'date':
      return formatMonth(v as number)
    case 'bool':
      return v ? 'yes' : 'no'
    case 'int':
      if (key === 'beds') return v === 0 ? 'studio' : `${v}BR`
      return String(v)
    case 'number':
      return Number(v).toLocaleString('en-US')
    case 'list':
      // Show what the sheet says ("pine nuts"), not the canonical family.
      return row.raw[key] || 'none'
    default:
      return String(v)
  }
}

export function cardLine(hit: Hit, schema: Schema): string {
  const parts = schema.card.map(f => {
    let s = formatCell(hit.row, f.key, schema)
    if (f.maxChars && s.length > f.maxChars) s = s.slice(0, f.maxChars).trimEnd()
    return (f.prefix ?? '') + s
  })
  parts.push(`r${hit.row.r}`)
  return parts.join(' ') + (hit.unsure.length ? ' ?' : '')
}

export function filterLine(q: Query, schema: Schema): string {
  if (!q.filters.length) return 'no filters'
  // Chips follow the sheet's column order, so the line reads the same way every time.
  const pos = (k: string) => schema.columns.findIndex(c => c.key === k)
  return [...q.filters]
    .sort((a, b) => pos(a.key) - pos(b.key))
    .map(f => describeFilter(f, schema))
    .join(' | ')
}

export interface ViewState {
  sheet: Sheet
  query: Query
  result: Result | null
  /** Index into result.hits of the highlighted row. */
  highlight: number
  shortlist: Set<number>
  listening: boolean
  /** Live or last transcript, shown while listening. */
  heard: string
  /** One-off message for the footer ("undid pets"). */
  flash?: string
  replay?: boolean
}

const mic = (s: ViewState) => (s.listening ? '●' : '○')

function finish(lines: string[]): string {
  return safe(lines.slice(0, MAX_LINES).map(l => fit(l)).join('\n'))
}

export function readyScreen(s: ViewState): string {
  const { sheet } = s
  const lines = [
    `${mic(s)} Onhand | ${sheet.schema.name}${s.replay ? ' | replay' : ''}`,
    `${sheet.rows.length} rows (synthetic)${sheet.skipped.length ? ` | ${sheet.skipped.length} skipped` : ''}`,
    '',
    'hold: listen to the client',
    'tap: shortlist   swipe: next row',
    'menu: details, undo, compare, end',
  ]
  return finish(lines)
}

export function listeningScreen(s: ViewState): string {
  const lines = [`● listening | ${s.query.filters.length ? filterLine(s.query, s.sheet.schema) : 'new request'}`, '']
  const heard = s.heard.trim()
  if (heard) lines.push(...wrap(`"${heard.slice(-160)}"`, 3))
  else lines.push('release to search')
  return finish(lines)
}

export function resultsScreen(s: ViewState): string {
  const { schema } = s.sheet
  const res = s.result
  if (!res) return readyScreen(s)
  const head = filterLine(s.query, schema)
  const lines: string[] = []

  if (!res.hits.length) {
    lines.push(`${mic(s)} ${head}`)
    lines.push('no rows match, even relaxed')
    lines.push('menu: Undo last filter')
    return finish(lines)
  }

  if (res.relaxed) {
    lines.push(`${mic(s)} none: ${head}`)
    lines.push(`nearest, ${res.relaxed.eased}`)
  } else {
    lines.push(fitHead(`${mic(s)} ${head}`, `${res.total}${res.maybe ? `+${res.maybe}?` : ''} match`))
  }

  const rowsShown = res.relaxed ? 2 : 3
  const start = Math.max(0, Math.min(s.highlight - 1, res.hits.length - rowsShown))
  for (let i = start; i < Math.min(start + rowsShown, res.hits.length); i++) {
    const hit = res.hits[i]
    const mark = i === s.highlight ? '▶' : s.shortlist.has(hit.row.r) ? '★' : ' '
    const star = i === s.highlight && s.shortlist.has(hit.row.r) ? '★' : ''
    lines.push(`${mark}${star} ${i + 1} ${cardLine(hit, schema)}`)
  }

  const why = whyLine(res.hits[s.highlight], schema, s.query)
  if (why) lines.push(`  ${why}`)
  lines.push(footer(s))
  return finish(lines)
}

function footer(s: ViewState): string {
  if (s.flash) return s.flash
  const n = s.shortlist.size
  const pos = s.result ? `${s.highlight + 1}/${s.result.hits.length}` : ''
  return `★ ${n} shortlisted   ${pos}`
}

/** Head line with the count pushed to the right where it fits. */
function fitHead(left: string, right: string): string {
  const gap = LINE_PX - estimateWidth(left) - estimateWidth(right)
  if (gap < 14) return fit(left, LINE_PX - estimateWidth(right) - 14) + '  ' + right
  return left + ' '.repeat(Math.max(2, Math.floor(gap / 7))) + right
}

export function detailScreen(s: ViewState): string {
  const { schema } = s.sheet
  const hit = s.result?.hits[s.highlight]
  if (!hit) return resultsScreen(s)
  const title = `${hit.row.raw[schema.titleKey]}${hit.row.raw.unit ? ' #' + hit.row.raw.unit : ''} r${hit.row.r}`
  const pairs = schema.detail
    .filter(k => k !== schema.titleKey)
    .map(k => `${column(schema, k).label ?? k}: ${formatCell(hit.row, k, schema)}`)
  const lines = [title]
  // Two short fields per line; long ones (plan, notes) get their own line.
  let cur = ''
  for (const p of pairs) {
    if (p.length > 22) {
      if (cur) lines.push(cur)
      cur = ''
      lines.push(p)
    } else if (!cur) cur = p
    else {
      lines.push(`${cur} | ${p}`)
      cur = ''
    }
  }
  if (cur) lines.push(cur)
  lines.splice(MAX_LINES - 1)
  lines.push('tap or swipe: back')
  return finish(lines)
}

export function compareScreen(s: ViewState, a: number, b: number): string {
  const { schema } = s.sheet
  const ha = s.result?.hits[a]
  const hb = s.result?.hits[b]
  if (!ha || !hb) return finish(['compare needs two rows', 'tap or swipe: back'])
  const lines = [`${a + 1} ${ha.row.raw[schema.titleKey]} r${ha.row.r}  vs  ${b + 1} ${hb.row.raw[schema.titleKey]} r${hb.row.r}`]
  for (const d of diffRows(ha.row, hb.row, schema)) {
    const col = column(schema, d.key)
    lines.push(`${col.label ?? d.key}: ${formatCell(ha.row, d.key, schema)} | ${formatCell(hb.row, d.key, schema)}`)
  }
  lines.splice(MAX_LINES - 1)
  lines.push('tap or swipe: back')
  return finish(lines)
}

export function recapScreen(s: ViewState, requests: number, note: string): string {
  const { schema } = s.sheet
  const rows = s.sheet.rows.filter(r => s.shortlist.has(r.r))
  const lines = [`Meeting ended | ${requests} requests`, `${s.shortlist.size} shortlisted`]
  for (const row of rows.slice(0, 4)) lines.push(`★ ${cardLine({ row, unsure: [] }, schema)}`)
  lines.push(note)
  return finish(lines)
}

function wrap(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (estimateWidth(next) > LINE_PX && cur) {
      out.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) out.push(cur)
  return out.slice(-maxLines)
}
