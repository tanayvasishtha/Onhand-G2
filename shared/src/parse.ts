// Deterministic request parser, first cut. Turns "two bed in Marina under
// 2.5 million with a sea view" into a FilterPatch using only the schema and the
// values that exist in the sheet. The Claude fallback only runs when
// `unparsed` still holds words that look like a requirement.

import type { Column, Filter, FilterPatch, Sheet, SortSpec } from './types'
import { aliasIndex, READY, parseMonth } from './normalize'
import { parseWhen } from './when'

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
}

/** Lower-cases, spells numbers as digits, keeps decimals. */
export function prepare(text: string): string {
  let t = ` ${text.toLowerCase()} `
    .replace(/[’']/g, '')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[^a-z0-9.+/ ]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
  // "twenty five" -> 25, then single words.
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(SMALL[a] + SMALL[b]))
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, w => String(SMALL[w]))
  t = t.replace(/\bhalf a\b/g, '0.5').replace(/\ba half\b/g, '0.5')
  t = t.replace(/\b(\d+) and 0\.5\b/g, (_, n) => `${n}.5`)
  t = t.replace(/\b(\d+) point (\d+)\b/g, '$1.$2')
  t = t.replace(/\b(\d+(?:\.\d+)?) (hundred)\b/g, (_, n) => String(Number(n) * 100))
  t = t.replace(/\ba (million|thousand)\b/g, '1 $1')
  return t.replace(/\s+/g, ' ').trim()
}

const SCALE: Record<string, number> = {
  k: 1e3, thousand: 1e3, grand: 1e3, m: 1e6, mn: 1e6, mil: 1e6, million: 1e6, millions: 1e6,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, cr: 1e7, crore: 1e7, crores: 1e7,
}
const MONEY = String.raw`(?:aed |dirhams? |usd |\$)?(\d+(?:\.\d+)?)\s*(millions?|thousand|grand|lakhs?|lac|crores?|mil|mn|cr|k|m)?\b(?: aed| dirhams?)?`
const NEG = /\b(no|not|without|except|anything but|other than|avoid|free of|allergic to|isnt|dont want|doesnt want|does not want|do not want|cant have|cannot have|cant eat|cannot eat|can not have)\s+((?:\w+\s+){0,2})$/

interface Span {
  start: number
  end: number
}

class Text {
  used: Span[] = []
  constructor(public t: string) {}
  free(s: number, e: number) {
    return !this.used.some(u => s < u.end && e > u.start)
  }
  take(s: number, e: number) {
    this.used.push({ start: s, end: e })
  }
  /** Finds unconsumed matches of a regex (must be global). */
  *find(re: RegExp): Generator<RegExpExecArray> {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(this.t))) {
      if (this.free(m.index, m.index + m[0].length)) yield m
      if (m[0].length === 0) re.lastIndex++
    }
  }
  leftover(): string {
    let out = ''
    for (let i = 0; i < this.t.length; i++) out += this.free(i, i + 1) ? this.t[i] : ' '
    return out
  }
  before(i: number): string {
    return this.t.slice(Math.max(0, i - 40), i)
  }
}

function priceRange(sheet: Sheet): [number, number] {
  const key = sheet.schema.priceKey
  const vals = sheet.rows.map(r => (key ? r.values[key] : null)).filter((v): v is number => typeof v === 'number')
  return vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, Infinity]
}

/**
 * Reads a spoken amount. Without a scale word, picks the power of ten that
 * lands inside the sheet's price range ("2.5" means 2.5M when every price is
 * over a million).
 */
function money(num: string, scale: string | undefined, sheet: Sheet): number {
  const n = Number(num)
  if (scale) return Math.round(n * SCALE[scale])
  const [lo, hi] = priceRange(sheet)
  if (n >= lo / 3 && n <= hi * 3) return n
  for (const s of [1e3, 1e6, 1e5, 1e7]) {
    const v = n * s
    if (v >= lo / 3 && v <= hi * 3) return Math.round(v)
  }
  return n
}

function wordRe(alias: string): RegExp {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'g')
}

const STOP = new Set(
  'a an the i we they he she it is are was be to of in on at for with and or but so um uh like just really very looking look want wants need needs something some any anything thing one ones please show me find get give have has do does can could would should what whats how about my our their his her client they him them apartment apartments flat flats unit units home house place property properties car cars dish dishes options option also maybe ideally prefer preferably around near ok okay well yeah yes then that this there here its im were okay right sure kind sort of bit lot good nice great view views actually instead rather allow allows allowed must got about what how with need should bedroom bedrooms bed beds price budget dirhams aed no not only free first do you without allergic cant cannot nothing low high food dishes there are'.split(
    ' ',
  ),
)

export function parse(text: string, sheet: Sheet): FilterPatch {
  const { schema } = sheet
  const T = new Text(prepare(text))
  const set: Filter[] = []
  const remove: string[] = []
  let sort: SortSpec | undefined
  let clear = false
  let command: FilterPatch['command']

  // Booking a viewing, visit or test drive is a request on its own, never a filter.
  const book = T.t.match(/\b(?:book|schedule|set up|arrange|fix|line up)\b(?: me| us| them)?(?: in)?(?: a| an| the)? ?(viewing|visit|showing|tour|test drive|tasting|appointment|meeting|call|interview)\b/)
  if (book) {
    const n = T.t.match(/\b(?:number|option|row) (\d{1,2})\b/) ?? T.t.match(/\bfor (\d)\b(?! ?(?:am|pm|\d))/)
    return {
      set: [],
      remove: [],
      command: { kind: 'book', what: book[1], index: n ? Number(n[1]) - 1 : undefined, when: parseWhen(T.t) },
      unparsed: '',
    }
  }

  // Commands and resets.
  for (const m of T.find(/\b(start over|clear (?:all|everything|filters)|reset|new search)\b/g)) {
    clear = true
    T.take(m.index, m.index + m[0].length)
  }
  for (const m of T.find(/\bcompare (\d) (?:and|with|to|vs) (\d)\b/g)) {
    command = { kind: 'compare', a: Number(m[1]) - 1, b: Number(m[2]) - 1 }
    T.take(m.index, m.index + m[0].length)
  }
  for (const m of T.find(/\bhow many\b/g)) {
    command = { kind: 'count' }
    T.take(m.index, m.index + m[0].length)
  }
  for (const m of T.find(/\b(?:tell me (?:more )?about|details? (?:on|for|of)?|more on) (?:number |option )?(\d)\b/g)) {
    command = { kind: 'detail', index: Number(m[1]) - 1 }
    T.take(m.index, m.index + m[0].length)
  }

  // Sorting.
  const sorts: [RegExp, () => SortSpec | undefined][] = [
    [/\b(cheapest|lowest price|least expensive|most affordable|cheaper ones)\b/g, () => (schema.priceKey ? { key: schema.priceKey, dir: 'asc' } : undefined)],
    [/\b(most expensive|priciest|top end|highest price)\b/g, () => (schema.priceKey ? { key: schema.priceKey, dir: 'desc' } : undefined)],
    [/\b(biggest|largest|most space|most spacious)\b/g, () => (schema.sizeKey && schema.sizeKey !== 'mileage' ? { key: schema.sizeKey, dir: 'desc' } : undefined)],
    [/\b(lowest mileage|low mileage|least driven)\b/g, () => (schema.columns.some(c => c.key === 'mileage') ? { key: 'mileage', dir: 'asc' } : undefined)],
    [/\b(newest|latest model)\b/g, () => (schema.columns.some(c => c.key === 'year') ? { key: 'year', dir: 'desc' } : undefined)],
  ]
  for (const [re, mk] of sorts) {
    for (const m of T.find(re)) {
      const s = mk()
      if (s) {
        sort = s
        T.take(m.index, m.index + m[0].length)
      }
    }
  }

  // Columns that a following number belongs to because of its unit ("50k km").
  const unitCols = schema.columns.filter(c => c.unitWords?.length)
  for (const col of unitCols) {
    const units = col.unitWords!.map(u => u.replace(/ /g, '\\s+')).join('|')
    const re = new RegExp(String.raw`\b(under|below|less than|max|up to|over|above|at least|more than|min)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\s*(?:${units})\b`, 'g')
    for (const m of T.find(re)) {
      const v = Number(m[2]) * (m[3] ? 1e3 : 1)
      const lower = m[1] && /over|above|at least|more|min/.test(m[1])
      set.push(lower ? { key: col.key, op: 'range', min: v } : { key: col.key, op: 'range', max: v })
      T.take(m.index, m.index + m[0].length)
    }
  }

  // Floor: "high floor, above 30", "floor 20 or higher", "below the 10th floor".
  if (schema.columns.some(c => c.key === 'floor')) {
    const re = /\b(?:high |low )?(?:floor|level)s?\b[^0-9]{0,14}?(above|over|higher than|at least|below|under|lower than)?\s*(\d{1,3})(?:st|nd|rd|th)?\b( or (?:higher|above|more|lower|below))?/g
    const after = /\b(above|over|higher than|at least|below|under|lower than) (?:the )?(\d{1,3})(?:st|nd|rd|th)? floor\b/g
    for (const m of [...T.find(re), ...T.find(after)]) {
      if (!T.free(m.index, m.index + m[0].length)) continue
      const n = Number(m[2])
      const dir = `${m[1] ?? ''} ${m[3] ?? ''}`
      set.push(
        /above|over|higher|least|more/.test(dir)
          ? { key: 'floor', op: 'range', min: n }
          : /below|under|lower/.test(dir)
            ? { key: 'floor', op: 'range', max: n }
            : { key: 'floor', op: 'range', min: n, max: n },
      )
      T.take(m.index, m.index + m[0].length)
    }
  }

  // Spice level: "nothing spicy", "mild", "spice level 3", "spicy".
  if (schema.columns.some(c => c.key === 'spice')) {
    for (const m of T.find(/\b(?:not|nothing|no|non) (?:too )?(?:spicy|hot|spice)\b|\bmild\b/g)) {
      set.push({ key: 'spice', op: 'range', max: 0 })
      T.take(m.index, m.index + m[0].length)
    }
    for (const m of T.find(/\b(?:spicy|spice|hot|heat)\b(?: food| dishes?)?(?: level)?\s*(\d)?\b(?: level (\d))?|\blevel (\d)\b/g)) {
      const n = m[1] ?? m[2] ?? m[3]
      set.push(n ? { key: 'spice', op: 'range', min: Number(n), max: Number(n) } : { key: 'spice', op: 'range', min: 1 })
      T.take(m.index, m.index + m[0].length)
    }
  }

  // Counted columns: "2 bed", "two or three bed", "3 bedrooms or more", "studio".
  for (const col of schema.columns.filter(c => c.type === 'int' && c.synonyms?.length && c.key !== 'year')) {
    if (col.key === 'spice' || col.key === 'floor') continue
    const syn = col.synonyms!.map(s => s.replace('/', '\\/')).sort((a, b) => b.length - a.length).join('|')
    for (const m of T.find(new RegExp(String.raw`\b(\d+) (?:or|to) (\d+)\s*-?\s*(?:${syn})\b`, 'g'))) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y)
      set.push({ key: col.key, op: 'range', min: a, max: b })
      T.take(m.index, m.index + m[0].length)
    }
    const re = new RegExp(String.raw`\b(\d+)\s*(\+|plus)?\s*-?\s*(?:${syn})\b(\s*(?:or more|plus|\+|and up|or bigger|or larger))?`, 'g')
    for (const m of T.find(re)) {
      const n = Number(m[1])
      set.push(m[2] || m[3] ? { key: col.key, op: 'range', min: n } : { key: col.key, op: 'range', min: n, max: n })
      T.take(m.index, m.index + m[0].length)
    }
    if (col.key === 'beds') {
      for (const m of T.find(/\bstudios?\b/g)) {
        // "one bed or studio": widen the bed count down to zero.
        const other = /\bor\b/.test(T.t) ? set.find(f => f.key === 'beds' && f.op === 'range' && f.min === f.max) : undefined
        if (other && other.op === 'range') other.min = 0
        else set.push({ key: 'beds', op: 'range', min: 0, max: 0 })
        T.take(m.index, m.index + m[0].length)
      }
    }
  }

  // Model year: "2022 or newer", "newer than 2020", "a 2023".
  if (schema.columns.some(c => c.key === 'year')) {
    for (const m of T.find(/\b(?:from |between )?(20[0-3]\d) (?:to|and|through) (20[0-3]\d)\b/g)) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y)
      set.push({ key: 'year', op: 'range', min: a, max: b })
      T.take(m.index, m.index + m[0].length)
    }
    for (const m of T.find(/\b(?:from |since |after |newer than )?(20[0-3]\d)( or newer| or later| onwards| and up| plus|\+)?\b/g)) {
      const y = Number(m[1])
      const lower = /from|since|after|newer/.test(m[0]) || !!m[2]
      set.push(lower ? { key: 'year', op: 'range', min: /after|newer than/.test(m[0]) ? y + 1 : y } : { key: 'year', op: 'range', min: y, max: y })
      T.take(m.index, m.index + m[0].length)
    }
  }

  // Handover: "ready", "off plan", "by 2027", "handover Q3 2026".
  if (schema.columns.some(c => c.key === 'handover')) {
    for (const m of T.find(/\b(ready(?: to move(?: in)?)?|move in now|completed|secondary)\b/g)) {
      set.push({ key: 'handover', op: 'range', max: READY })
      T.take(m.index, m.index + m[0].length)
    }
    for (const m of T.find(/\boff ?plan\b/g)) {
      set.push({ key: 'handover', op: 'range', min: READY + 1 })
      T.take(m.index, m.index + m[0].length)
    }
    for (const m of T.find(/\b(?:by|before|handover(?: in| by)?|ready by) (q[1-4] ?\d{2,4}|20\d\d|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4})\b/g)) {
      const idx = parseMonth(m[1])
      if (idx != null) {
        set.push({ key: 'handover', op: 'range', max: idx })
        T.take(m.index, m.index + m[0].length)
      }
    }
  }

  // Money.
  if (schema.priceKey) {
    const pk = schema.priceKey
    // "between 1.2 and 1.8 million", or "1.5 to 2 million" when a scale word says it is money.
    const between = new RegExp(String.raw`\b(between |from )?${MONEY} (?:and|to) ${MONEY}`, 'g')
    for (const raw of T.find(between)) {
      if (!raw[1] && !raw[3] && !raw[5]) continue
      const hiScale = raw[5] ?? raw[3]
      set.push({ key: pk, op: 'range', min: money(raw[2], raw[3] ?? hiScale, sheet), max: money(raw[4], hiScale, sheet) })
      T.take(raw.index, raw.index + raw[0].length)
    }
    const maxRe = new RegExp(String.raw`\b(?:under|below|max|maximum|up to|upto|less than|within|no more than|not more than|cheaper than|budget(?: is| of)?|at most|tops)\s+${MONEY}`, 'g')
    for (const m of T.find(maxRe)) {
      set.push({ key: pk, op: 'range', max: money(m[1], m[2], sheet) })
      T.take(m.index, m.index + m[0].length)
    }
    const maxAfter = new RegExp(String.raw`\b${MONEY}\s+(?:max|maximum|tops|or less|or under|or below|at most)\b`, 'g')
    for (const m of T.find(maxAfter)) {
      set.push({ key: pk, op: 'range', max: money(m[1], m[2], sheet) })
      T.take(m.index, m.index + m[0].length)
    }
    const minRe = new RegExp(String.raw`\b(?:over|above|at least|min|minimum|more than|starting at)\s+${MONEY}`, 'g')
    for (const m of T.find(minRe)) {
      set.push({ key: pk, op: 'range', min: money(m[1], m[2], sheet) })
      T.take(m.index, m.index + m[0].length)
    }
    const aroundRe = new RegExp(String.raw`\b(?:around|about|roughly|approximately|approx)\s+${MONEY}`, 'g')
    for (const m of T.find(aroundRe)) {
      const v = money(m[1], m[2], sheet)
      set.push({ key: pk, op: 'range', min: Math.round(v * 0.9), max: Math.round(v * 1.1) })
      T.take(m.index, m.index + m[0].length)
    }
    // A bare amount with a scale word ("2.5 million") is read as a budget cap.
    const bare = /\b(\d+(?:\.\d+)?)\s*(millions?|thousand|lakhs?|crores?|mn|cr|k|m)\b/g
    for (const m of T.find(bare)) {
      set.push({ key: pk, op: 'range', max: money(m[1], m[2], sheet) })
      T.take(m.index, m.index + m[0].length)
    }
  }

  // Removals: "forget the view", "pets doesnt matter".
  const removeRe = /\b(?:forget|drop|remove|ignore|never mind|skip)(?: about)?(?: the)? (\w+(?: \w+)?)|(\w+(?: \w+)?) (?:doesnt matter|dont matter|does not matter|do not matter|is not important|not important|arent important|is fine either way|not needed)/g
  for (const m of T.find(removeRe)) {
    const words = (m[1] ?? m[2]).split(' ')
    const col = schema.columns.find(c => words.some(w => c.key === w || c.synonyms?.includes(w) || Object.keys(c.values ?? {}).some(v => v.toLowerCase() === w)))
    if (col) {
      remove.push(col.key)
      if (col.key === schema.priceKey) remove.push(col.key)
      T.take(m.index, m.index + m[0].length)
    }
  }

  // Category and list values: longest alias first so "marina view" wins over "marina".
  const terms: { alias: string; col: Column; canon: string }[] = []
  for (const col of schema.columns.filter(c => c.type === 'category' || c.type === 'list')) {
    const idx = aliasIndex(col.values)
    for (const r of sheet.rows) {
      const v = r.values[col.key]
      if (typeof v === 'string' && v.length >= 3) idx.set(v.toLowerCase(), v)
    }
    for (const [alias, canon] of idx) terms.push({ alias, col, canon })
  }
  terms.sort((a, b) => b.alias.length - a.alias.length)
  const catPos = new Map<string, { vals: string[]; neg: string[] }>()
  const question = /\b(does|do|is|has|have|contain|contains|any)\b/.test(T.t) && /\?|\b(does|do)\b/.test(text.toLowerCase())
  for (const term of terms) {
    for (const m of T.find(wordRe(term.alias))) {
      const before = T.before(m.index)
      const neg = NEG.test(before) || /\s*-?\s*free\b/.test(T.t.slice(m.index + m[0].length, m.index + m[0].length + 6))
      T.take(m.index, m.index + m[0].length)
      if (term.col.type === 'list') {
        if (neg) set.push({ key: term.col.key, op: 'lacks', values: [term.canon] })
        else if (!question) set.push({ key: term.col.key, op: 'has', values: [term.canon] })
        continue
      }
      const slot = catPos.get(term.col.key) ?? { vals: [], neg: [] }
      ;(neg ? slot.neg : slot.vals).push(term.canon)
      catPos.set(term.col.key, slot)
    }
  }
  for (const [key, slot] of catPos) {
    if (slot.vals.length) set.push({ key, op: 'in', values: [...new Set(slot.vals)] })
    if (slot.neg.length) set.push({ key, op: 'not_in', values: [...new Set(slot.neg)] })
  }
  // Merge list filters on the same key.
  const merged: Filter[] = []
  for (const f of set) {
    const prev = merged.find(x => x.key === f.key && x.op === f.op && (f.op === 'lacks' || f.op === 'has'))
    if (prev && (prev.op === 'lacks' || prev.op === 'has') && (f.op === 'lacks' || f.op === 'has')) prev.values = [...new Set([...prev.values, ...f.values])]
    else merged.push(f)
  }

  // Yes/no columns: "pets allowed", "no pets", "unfurnished", "vegan".
  for (const col of schema.columns.filter(c => c.type === 'bool')) {
    const syn = [...(col.synonyms ?? []), col.key].sort((a, b) => b.length - a.length)
    let done = false
    for (const s of syn) {
      if (done) break
      for (const m of T.find(new RegExp(String.raw`\b(un|non[- ]?)?${s.replace(/ /g, '\\s+')}\b`, 'g'))) {
        const neg = !!m[1] || NEG.test(T.before(m.index))
        merged.push({ key: col.key, op: 'is', value: !neg })
        T.take(m.index, m.index + m[0].length)
        done = true
        break
      }
    }
  }

  // Words from row titles ("risotto", "land cruiser") narrow by name.
  const titleWords = new Set<string>()
  for (const r of sheet.rows) {
    for (const w of String(r.values[schema.titleKey] ?? '').toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4) titleWords.add(w)
  }
  const named: string[] = []
  for (const m of T.find(/\b[a-z][a-z0-9]{3,}\b/g)) {
    if (titleWords.has(m[0]) && !STOP.has(m[0])) {
      named.push(m[0])
      T.take(m.index, m.index + m[0].length)
    }
  }
  if (named.length) merged.push({ key: schema.titleKey, op: 'text', q: named.join(' ') })

  const unparsed = T.leftover()
    .split(/\s+/)
    .filter(w => w && !STOP.has(w) && !/^\d+$/.test(w))
    .join(' ')

  return { set: dedupe(merged), remove: [...new Set(remove)], clear: clear || undefined, sort, command, unparsed }
}

/** Keeps the last filter per (key, op), so a corrected value wins inside one utterance. */
function dedupe(filters: Filter[]): Filter[] {
  const out = new Map<string, Filter>()
  for (const f of filters) out.set(`${f.key}:${f.op}`, f)
  return [...out.values()]
}
