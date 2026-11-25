// Turns messy sheet cells into numbers, booleans, month indexes and canonical
// category values. Code only: nothing here guesses with a model.

const CURRENCY = /(aed|dhs?|usd|inr|rs\.?|us\$|\$|₹|€|£)/gi

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  mil: 1e6,
  mio: 1e6,
  million: 1e6,
  millions: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  l: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
}

/**
 * "2.5M", "2,500,000", "AED 2.5m", "2.5 mn", "25 lakh", "1.2 Cr", "₹25,00,000",
 * "850k" -> a plain number. Blank, "TBC", "call" -> null.
 */
export function parseMoney(input: string | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).toLowerCase().replace(CURRENCY, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  const m = s.match(/^(-?[\d,]*\.?\d+)\s*([a-z]+)?\.?$/)
  if (!m) return null
  const num = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(num)) return null
  const unit = m[2]
  if (!unit) return num
  const scale = SCALE[unit]
  return scale ? Math.round(num * scale) : null
}

/** "1,250 sqft", "45,000 km", "12.5" -> number. */
export function parseNumber(input: string | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).replace(/,/g, '')
  const k = s.match(/(-?\d+(?:\.\d+)?)\s*k\b/i)
  if (k) return Math.round(Number(k[1]) * 1000)
  const m = s.match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

/** "Studio" -> 0, "2BR", "2 bed", "3 Bedroom + maid", "4+" -> 4. */
export function parseCount(input: string | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).toLowerCase().trim()
  if (!s) return null
  if (/^studio\b|^st$/.test(s)) return 0
  const m = s.match(/(\d+)/)
  return m ? Number(m[1]) : null
}

const TRUE_WORDS = new Set(['yes', 'y', 'true', '1', '✓', '✔', 'allowed', 'ok', 'available'])
const FALSE_WORDS = new Set(['no', 'n', 'false', '0', '✗', '✘', 'x', 'not allowed', 'none', 'unavailable'])

/** Blank or unreadable -> null (unknown), never false. */
export function parseBool(input: string | null | undefined): boolean | null {
  if (input == null) return null
  const s = String(input).toLowerCase().trim()
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Month index used for "ready" (handed over already). Sorts before any date. */
export const READY = 0

function fullYear(y: string): number {
  const n = Number(y)
  return y.length <= 2 ? 2000 + n : n
}

/**
 * "Ready", "Q3 2026", "Q3-26", "Dec 2027", "12/2027", "2027" -> a sortable
 * month index (year * 12 + month0). Quarters map to their last month; a bare
 * year maps to December.
 */
export function parseMonth(input: string | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).toLowerCase().trim()
  if (!s) return null
  if (/^(ready|completed|handed over|done)\b/.test(s)) return READY
  let m = s.match(/^q([1-4])\s*[-/ ]?\s*'?(\d{2}|\d{4})$/)
  if (m) return fullYear(m[2]) * 12 + Number(m[1]) * 3 - 1
  m = s.match(/^([a-z]{3})[a-z]*\.?\s*[-/ ]?\s*'?(\d{2}|\d{4})$/)
  if (m && MONTHS.includes(m[1])) return fullYear(m[2]) * 12 + MONTHS.indexOf(m[1])
  m = s.match(/^(\d{1,2})\s*[/-]\s*(\d{4})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return Number(m[2]) * 12 + Number(m[1]) - 1
  m = s.match(/^(\d{4})$/)
  if (m) return Number(m[1]) * 12 + 11
  return null
}

/** Month index -> "ready" or "Q3-26". */
export function formatMonth(idx: number | null): string {
  if (idx == null) return '?'
  if (idx === READY) return 'ready'
  const year = Math.floor(idx / 12)
  const q = Math.floor((idx % 12) / 3) + 1
  return `Q${q}-${String(year).slice(-2)}`
}

export function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Builds a lookup from every alias (and the canonical name) to the canonical value. */
export function aliasIndex(values: Record<string, string[]> | undefined): Map<string, string> {
  const idx = new Map<string, string>()
  if (!values) return idx
  for (const [canon, aliases] of Object.entries(values)) {
    idx.set(normText(canon), canon)
    for (const a of aliases) idx.set(normText(a), canon)
  }
  return idx
}

/** "dubai marina " -> "Dubai Marina" when known; unknown values keep their trimmed text. */
export function parseCategory(input: string | null | undefined, idx: Map<string, string>): string | null {
  if (input == null) return null
  const t = normText(String(input))
  if (!t) return null
  return idx.get(t) ?? String(input).trim()
}

/** "nuts, gluten; Dairy" -> canonical values. Unknown items keep their trimmed text. */
export function parseList(input: string | null | undefined, idx: Map<string, string>): string[] | null {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null
  if (/^(none|nil|-|n\/a)$/i.test(s)) return []
  const out = new Set<string>()
  for (const part of s.split(/[,;/|]+/)) {
    const t = normText(part)
    if (t) out.add(idx.get(t) ?? part.trim())
  }
  return [...out]
}

/** 2350000 -> "2.35M", 850000 -> "850k", 92500 -> "92.5k", 45 -> "45". */
export function formatMoney(n: number | null): string {
  if (n == null) return '?'
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${trim(n / 1e6, 2)}M`
  if (abs >= 1e3) return `${trim(n / 1e3, 1)}k`
  return trim(n, 2)
}

function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)))
}
