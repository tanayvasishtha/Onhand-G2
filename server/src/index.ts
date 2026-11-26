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
import { bookEvent, liveEnabled, loadLive, saveLead, type LiveSheet } from './live'

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

/** A plain status page, so opening the server URL in a browser shows what is running. */
app.get('/', c => {
  const on = (v: boolean) => (v ? 'on' : 'off')
  const tabs = [...live.values()].map(l => `<li>${l.tab}: ${l.sheet.rows.length} rows</li>`).join('')
  return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onhand server</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;background:#111;color:#e5e5e5}h1{font-size:22px;margin:0 0 4px}p{color:#a7a7a7;margin:0 0 20px}td{padding:4px 16px 4px 0}a{color:#3cfa44}</style></head>
<body><h1>Onhand server</h1><p>Backend for the Onhand app on Even Realities G2. Keys stay here; the app only talks to this server.</p>
<table><tr><td>Speech (Deepgram)</td><td>${on(speechEnabled())}</td></tr><tr><td>Claude fallback</td><td>${on(fallbackEnabled())}</td></tr><tr><td>Google Sheet</td><td>${on(liveEnabled() && !liveError)}</td></tr></table>
${tabs ? `<ul>${tabs}</ul>` : ''}<p><a href="/health">/health</a> &middot; <a href="https://github.com/tanayvasishtha/Onhand-G2">source on GitHub</a></p></body></html>`)
})

/** The live tab as CSV, so the app parses it with the same loader. */
app.get('/sheet/:id', async c => {
  const id = c.req.param('id')
  if (c.req.query('refresh')) await refreshLive()
  const l = live.get(id)
  if (!l) return c.json({ error: `no live sheet ${id}` }, 404)
  return c.text(l.csv, 200, { 'content-type': 'text/csv; charset=utf-8' })
})

/** Tap on the confirm screen: a Google Calendar event for one row. */
app.post('/book', async c => {
  const body = await c.req.json<{ sheet: string; r: number; what: string; when: { y: number; m: number; d: number; h: number; min: number; label: string }; minutes?: number }>()
  const sheet = sheets[body.sheet]
  if (!sheet) return c.json({ error: `unknown sheet ${body.sheet}` }, 404)
  if (!body.when?.y) return c.json({ error: 'no time given' }, 400)
  try {
    return c.json(await bookEvent({ sheet, r: body.r, what: body.what || 'viewing', when: body.when, minutes: Math.min(Math.max(body.minutes ?? 30, 15), 180) }))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502)
  }
})

/** End of meeting: shortlist -> a row on the Leads tab and a Gmail draft. */
app.post('/export', async c => {
  const body = await c.req.json<{ sheet: string; shortlist: number[]; requests: number; filters: string; transcript: string[]; bookings?: { r: number; what: string; label: string }[] }>()
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
