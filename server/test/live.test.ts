import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftText, loadLive, rowLine, saveLead } from '../src/live'
import { units } from '../../shared/test/fixtures'

const csv = readFileSync(new URL('../../shared/fixtures/dubai_units.csv', import.meta.url), 'utf8')

// Stands in for the Apps Script web app: same query contract and JSON replies.
function fakeScript() {
  const posts: any[] = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const u = new URL(input)
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      posts.push(body)
      if (body.token !== 't0k') return Response.json({ ok: false, error: 'bad token' })
      return Response.json({ ok: true, row: 2, draftUrl: 'https://mail.google.com/mail/u/0/#drafts?compose=abc' })
    }
    if (u.searchParams.get('token') !== 't0k') return Response.json({ ok: false, error: 'bad token' })
    if (u.searchParams.get('action') === 'ping') return Response.json({ ok: true, name: 'Agency stock', tabs: ['Units', 'Leads'] })
    if (u.searchParams.get('action') === 'read' && u.searchParams.get('tab') === 'Units') return new Response(csv)
    return Response.json({ ok: false, error: 'no tab' })
  })
  return { fetchMock, posts }
}

describe('live Google Sheet through the Apps Script bridge', () => {
  beforeEach(() => {
    process.env.SHEET_SCRIPT_URL = 'https://script.example/exec'
    process.env.SHEET_SCRIPT_TOKEN = 't0k'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.SHEET_SCRIPT_URL
    delete process.env.SHEET_SCRIPT_TOKEN
  })

  it('reads only the mapped tabs that exist, with the same loader as the CSVs', async () => {
    const { fetchMock } = fakeScript()
    vi.stubGlobal('fetch', fetchMock)
    const live = await loadLive()
    expect(live.map(l => l.id)).toEqual(['live-dubai-units'])
    expect(live[0].sheet.rows.length).toBe(units.rows.length)
    expect(live[0].sheet.schema.name).toBe('Agency stock: Units')
  })

  it('sends the shortlist with sheet row numbers and a draft', async () => {
    const { fetchMock, posts } = fakeScript()
    vi.stubGlobal('fetch', fetchMock)
    const out = await saveLead({ sheet: units, tab: 'Units', shortlist: [43, 12], requests: 3, filters: '2BR | Marina', transcript: ['two bed in marina'] })
    expect(out.row).toBe(2)
    expect(posts[0].shortlist.map((s: any) => s.r)).toEqual([43, 12])
    expect(posts[0].subject).toBe('The 2 options we talked about today')
    expect(posts[0].body).toContain('(sheet row 43)')
  })

  it('surfaces a wrong token as an error', async () => {
    process.env.SHEET_SCRIPT_TOKEN = 'nope'
    vi.stubGlobal('fetch', fakeScript().fetchMock)
    await expect(saveLead({ sheet: units, tab: 'Units', shortlist: [12], requests: 1, filters: '', transcript: [] })).rejects.toThrow('bad token')
  })

  it('writes rows from the sheet values', () => {
    expect(rowLine(units, 43)).toMatch(/^Harbour Crest, unit 1804, 2BR, .*price AED 2\.35M.*\(sheet row 43\)$/)
    expect(draftText({ sheet: units, tab: 'Units', shortlist: [43], requests: 1, filters: '', transcript: [] }).subject).toBe('The option we talked about today')
  })
})

describe('booking a viewing', () => {
  it('names the booked option in the follow-up email', () => {
    const { body } = draftText({ sheet: units, tab: 'Units', shortlist: [12, 43], requests: 3, filters: '', transcript: [], bookings: [{ r: 43, what: 'viewing', label: 'Sat 28 Nov, 11:00' }] })
    expect(body).toContain('We are booked to see option 2 on Sat 28 Nov at 11:00.')
    expect(body).toContain('Tell me if you would like to see any of the others too.')
  })
})
