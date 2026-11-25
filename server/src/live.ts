// The user's own Google Sheet, through the Apps Script bridge in apps-script/.
// Tabs are read as displayed values and parsed with the same loader as the
// bundled CSVs. At the end of a meeting the shortlist becomes a row on the
// Leads tab and a Gmail draft. The script URL and token stay on the server.

import { formatCell, loadCsv, SCHEMAS, type Schema, type Sheet } from '@onhand/shared'

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

/** Lists the tabs, then reads each mapped tab that exists. */
export async function loadLive(): Promise<LiveSheet[]> {
  if (!liveEnabled()) return []
  const ping = (await (await call({ action: 'ping' })).json()) as { ok: boolean; name?: string; tabs?: string[]; error?: string }
  if (!ping.ok) throw new Error(`sheet script: ${ping.error}`)
  const out: LiveSheet[] = []
  for (const [tab, schemaId] of tabMap()) {
    if (!ping.tabs?.includes(tab)) continue
    const res = await call({ action: 'read', tab })
    const csv = await res.text()
    if (csv.startsWith('{')) throw new Error(`sheet script: ${csv}`)
    const base = SCHEMAS[schemaId]
    const schema: Schema = { ...base, id: `live-${base.id}`, name: `${ping.name ?? 'Google Sheet'}: ${tab}`, source: `Live Google Sheet "${ping.name}", tab ${tab}.` }
    out.push({ id: schema.id, tab, csv, sheet: loadCsv(csv, schema) })
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
  const subject = n === 1 ? 'The option we talked about today' : `The ${n} options we talked about today`
  const body = [
    'Hi,',
    '',
    `Thanks for your time today. ${n === 1 ? 'Here is the option' : 'Here are the options'} we talked about:`,
    '',
    ...lines.map((l, i) => `${i + 1}. ${l.line}`),
    '',
    'Tell me which ones you would like to see and I will set it up.',
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
