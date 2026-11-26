// The user's own Google Sheet, through the Apps Script bridge in apps-script/.
// Tabs are read as displayed values and parsed with the same loader as the
// bundled CSVs. At the end of a meeting the shortlist becomes a row on the
// Leads tab and a Gmail draft. The script URL and token stay on the server.

import { formatCell, inferSchema, loadCsv, parseCsv, SCHEMAS, type Schema, type Sheet } from '@onhand/shared'

const url = () => process.env.SHEET_SCRIPT_URL ?? ''
const token = () => process.env.SHEET_SCRIPT_TOKEN ?? ''
export const liveEnabled = () => Boolean(url() && token())

/** Tab name in the Google Sheet -> schema id. Override with SHEET_TABS="Stock=dubai-units,Menu=restaurant-menu". */
function tabMap(): [string, string][] {
  const raw = process.env.SHEET_TABS ?? 'Units=dubai-units,Menu=restaurant-menu,Cars=car-stock'
  return raw
    .split(',')
    .map(p => p.split('=').map(s => s.trim()) as [string, string])
    .filter(([tab, id]) => tab && SCHEMAS[id])
}

export interface LiveSheet {
  id: string
  tab: string
  csv: string
  sheet: Sheet
}

async function call(params: Record<string, string>): Promise<Response> {
  const q = new URLSearchParams({ token: token(), ...params })
  const res = await fetch(`${url()}?${q}`, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`sheet script answered ${res.status}`)
  return res
}

/** Id for a tab with no known layout: "live-tab-" + the tab name as a slug. */
export function tabId(tab: string): string {
  return `live-tab-${tab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

/**
 * Schema for one live tab: a known layout when the tab is mapped (Units, Menu,
 * Cars), otherwise one worked out from the tab's own columns. The app makes the
 * same choice from the same CSV, so both sides agree.
 */
export function liveSchema(id: string, name: string, csv: string): Schema {
  const base = SCHEMAS[id.replace(/^live-/, '')]
  if (base) return { ...base, id, name, source: `Live Google Sheet, ${name}.` }
  return inferSchema(parseCsv(csv), id, name)
}

/** Lists the tabs, then reads every tab except Leads. */
export async function loadLive(): Promise<LiveSheet[]> {
  if (!liveEnabled()) return []
  const ping = (await (await call({ action: 'ping' })).json()) as { ok: boolean; name?: string; tabs?: string[]; error?: string }
  if (!ping.ok) throw new Error(`sheet script: ${ping.error}`)
  const mapped = new Map(tabMap())
  const out: LiveSheet[] = []
  for (const tab of ping.tabs ?? []) {
    // Leads and old copies of it ("Leads (test)") hold output, not stock.
    if (/^leads/i.test(tab)) continue
    const res = await call({ action: 'read', tab })
    const csv = await res.text()
    if (csv.startsWith('{')) throw new Error(`sheet script: ${csv}`)
    if (!csv.trim() || !csv.includes('\n')) continue
    const schemaId = mapped.get(tab)
    const id = schemaId ? `live-${schemaId}` : tabId(tab)
    const name = `${ping.name ?? 'Google Sheet'}: ${tab}`
    try {
      out.push({ id, tab, csv, sheet: loadCsv(csv, liveSchema(id, name, csv)) })
    } catch (err) {
      console.warn(`google sheet: skipped tab ${tab}: ${(err as Error).message}`)
    }
  }
  return out
}

export interface LeadInput {
  sheet: Sheet
  tab: string
  shortlist: number[]
  requests: number
  filters: string
  transcript: string[]
  bookings?: { r: number; what: string; label: string }[]
  client?: string
}

/** One readable line per shortlisted row, in the same units the lens uses. */
export function rowLine(sheet: Sheet, r: number): string {
  const row = sheet.rows.find(x => x.r === r)
  if (!row) return `row ${r}`
  const { schema } = sheet
  const parts = [String(row.raw[schema.titleKey] ?? '').trim()]
  for (const c of schema.columns) {
    if (c.key === schema.titleKey || c.type === 'text' && c.key !== 'unit') continue
    if (row.values[c.key] == null) continue
    let v = formatCell(row, c.key, schema)
    if (c.type === 'money') v = `AED ${v}`
    const label = c.header.replace(/\s*\(.*\)\s*$/, '').toLowerCase()
    parts.push(c.type === 'category' || c.key === 'beds' ? v : `${label} ${v}`)
    if (parts.length >= 9) break
  }
  return `${parts.filter(Boolean).join(', ')} (sheet row ${r})`
}

export function draftText(input: LeadInput): { subject: string; body: string; lines: { r: number; line: string }[] } {
  const lines = input.shortlist.map(r => ({ r, line: rowLine(input.sheet, r) }))
  const n = lines.length
  const option = (r: number) => lines.findIndex(l => l.r === r) + 1
  const booked = (input.bookings ?? []).map(b => `We are booked to see option ${option(b.r) || `in sheet row ${b.r}`} on ${b.label.replace(',', ' at')}.`)
  const subject = n === 1 ? 'The option we talked about today' : `The ${n} options we talked about today`
  const body = [
    'Hi,',
    '',
    `Thanks for your time today. ${n === 1 ? 'Here is the option' : 'Here are the options'} we talked about:`,
    '',
    ...lines.map((l, i) => `${i + 1}. ${l.line}`),
    '',
    ...(booked.length ? [...booked, '', 'Tell me if you would like to see any of the others too.'] : ['Tell me which ones you would like to see and I will set it up.']),
  ].join('\n')
  return { subject, body, lines }
}

export async function saveLead(input: LeadInput): Promise<{ row: number; draftUrl: string }> {
  if (!liveEnabled()) throw new Error('no sheet script configured')
  const { subject, body, lines } = draftText(input)
  const res = await fetch(url(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: token(),
      action: 'lead',
      tab: input.tab,
      client: input.client ?? '',
      requests: input.requests,
      filters: input.filters,
      transcript: input.transcript,
      shortlist: lines,
      bookings: (input.bookings ?? []).map(b => `${b.what} ${b.label}, row ${b.r}`),
      subject,
      body,
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  })
  const out = (await res.json()) as { ok: boolean; row?: number; draftUrl?: string; error?: string }
  if (!out.ok) throw new Error(`sheet script: ${out.error}`)
  return { row: out.row!, draftUrl: out.draftUrl! }
}

export interface BookInput {
  sheet: Sheet
  r: number
  what: string
  when: { y: number; m: number; d: number; h: number; min: number; label: string }
  minutes: number
}

/** A Google Calendar event for one row, through the same Apps Script bridge. */
export async function bookEvent(input: BookInput): Promise<{ ok: true; start: string }> {
  if (!liveEnabled()) throw new Error('no sheet script configured')
  const row = input.sheet.rows.find(x => x.r === input.r)
  const name = row ? String(row.raw[input.sheet.schema.titleKey] ?? '').trim() : `row ${input.r}`
  const unit = row?.raw.unit ? ` #${row.raw.unit}` : ''
  const what = input.what[0].toUpperCase() + input.what.slice(1)
  const res = await fetch(url(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: token(),
      action: 'book',
      title: `${what}: ${name}${unit}`,
      description: `${rowLine(input.sheet, input.r)}\nBooked from Onhand during a client meeting.`,
      when: input.when,
      minutes: input.minutes,
    }),
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  })
  const out = (await res.json()) as { ok: boolean; start?: string; error?: string }
  if (!out.ok) throw new Error(`sheet script: ${out.error}`)
  return { ok: true, start: out.start ?? '' }
}
