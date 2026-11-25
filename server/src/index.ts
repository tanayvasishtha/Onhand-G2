// Onhand backend: speech relay (Deepgram), the Claude fallback for words the
// parser could not use, the user's Google Sheet through Apps Script, and the
// same parser and engine the app runs. Keys live here only; the app never sees them.

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { applyPatch, carStock, dubaiUnits, loadCsv, parse, restaurantMenu, run, type FilterPatch, type Query, type Sheet } from '@onhand/shared'
import { fallback, fallbackEnabled } from './fallback'
import { attachListen, speechEnabled } from './listen'
import { liveEnabled, loadLive, saveLead, type LiveSheet } from './live'

const fixture = (f: string) => readFileSync(new URL(`../../shared/fixtures/${f}`, import.meta.url), 'utf8')

const sheets: Record<string, Sheet> = {
  [dubaiUnits.id]: loadCsv(fixture('dubai_units.csv'), dubaiUnits),
  [restaurantMenu.id]: loadCsv(fixture('restaurant_menu.csv'), restaurantMenu),
  [carStock.id]: loadCsv(fixture('car_stock.csv'), carStock),
}

const live = new Map<string, LiveSheet>()
let liveError = ''

async function refreshLive() {
  try {
    const loaded = await loadLive()
    for (const l of loaded) {
      live.set(l.id, l)
      sheets[l.id] = l.sheet
    }
    liveError = ''
    return loaded.map(l => `${l.tab}: ${l.sheet.rows.length} rows`)
  } catch (err) {
    liveError = (err as Error).message
    return []
  }
}

const app = new Hono()
app.use('*', cors())

app.get('/health', c =>
  c.json({ ok: true, speech: speechEnabled(), fallback: fallbackEnabled(), sheet: liveEnabled() && !liveError, live: [...live.keys()], liveError: liveError || undefined }),
)

/** The live tab as CSV, so the app parses it with the same loader. */
app.get('/sheet/:id', async c => {
  const id = c.req.param('id')
  if (c.req.query('refresh')) await refreshLive()
  const l = live.get(id)
  if (!l) return c.json({ error: `no live sheet ${id}` }, 404)
  return c.text(l.csv, 200, { 'content-type': 'text/csv; charset=utf-8' })
})

/** End of meeting: shortlist -> a row on the Leads tab and a Gmail draft. */
app.post('/export', async c => {
  const body = await c.req.json<{ sheet: string; shortlist: number[]; requests: number; filters: string; transcript: string[] }>()
  const sheet = sheets[body.sheet]
  if (!sheet) return c.json({ error: `unknown sheet ${body.sheet}` }, 404)
  if (!body.shortlist?.length) return c.json({ error: 'nothing shortlisted' }, 400)
  try {
    const tab = live.get(body.sheet)?.tab ?? sheet.schema.name
    return c.json(await saveLead({ ...body, sheet, tab }))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
})

/** Words the app's parser left over go here. Returns extra filters checked against the sheet. */
app.post('/fallback', async c => {
  const body = await c.req.json<{ sheet: string; text: string; patch: FilterPatch }>()
  const sheet = sheets[body.sheet]
  if (!sheet) return c.json({ error: `unknown sheet ${body.sheet}` }, 404)
  try {
    return c.json((await fallback(body.text, sheet, body.patch)) ?? { set: [], remove: [], dropped: [], ms: 0, off: true })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
})

app.get('/sheets', c =>
  c.json(Object.values(sheets).map(s => ({ id: s.schema.id, name: s.schema.name, rows: s.rows.length, skipped: s.skipped, source: s.schema.source }))),
)

/** Parses one request against the session's current filters and returns the rows. */
app.post('/query', async c => {
  const body = await c.req.json<{ sheet: string; text: string; query?: Query }>()
  const sheet = sheets[body.sheet]
  if (!sheet) return c.json({ error: `unknown sheet ${body.sheet}` }, 404)
  const patch = parse(body.text ?? '', sheet)
  const query = applyPatch(body.query ?? { filters: [] }, patch)
  const result = run(sheet.rows, sheet.schema, query)
  return c.json({
    patch,
    query,
    total: result.total,
    maybe: result.maybe,
    relaxed: result.relaxed ?? null,
    hits: result.hits.slice(0, 10).map(h => ({ r: h.row.r, unsure: h.unsure, row: h.row.raw })),
  })
})

const port = Number(process.env.PORT ?? 8787)
const server = serve({ fetch: app.fetch, port }, async () => {
  console.log(`onhand server on http://localhost:${port} (speech ${speechEnabled() ? 'on' : 'off'}, fallback ${fallbackEnabled() ? 'on' : 'off'})`)
  if (liveEnabled()) {
    const tabs = await refreshLive()
    console.log(liveError ? `google sheet: ${liveError}` : `google sheet: ${tabs.join(', ') || 'no matching tabs'}`)
  }
})
attachListen(server as Server, sheets)
