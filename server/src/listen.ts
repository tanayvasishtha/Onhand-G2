// Speech for one ring hold. The app opens /listen when the hold starts, sends
// raw 16 kHz s16le PCM frames, then {"type":"stop"} on release. This relays
// the audio to Deepgram's live API with the sheet's own words as key terms and
// sends back interim text for the lens and one final transcript.

import type { Server } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import type { Sheet } from '@onhand/shared'

const DG_URL = 'wss://api.deepgram.com/v1/listen'
const FINAL_WAIT_MS = 1500

export const speechEnabled = () => Boolean(process.env.DEEPGRAM_API_KEY)

/** Names a listener is likely to say that a general model may misspell: areas, projects, makes. */
export function keyterms(sheet: Sheet, limit = 40): string[] {
  const out = new Set<string>()
  for (const c of sheet.schema.columns) {
    if (c.type === 'category') Object.keys(c.values ?? {}).forEach(v => out.add(v))
  }
  for (const r of sheet.rows) {
    const t = r.values[sheet.schema.titleKey]
    if (typeof t === 'string' && /[A-Z]/.test(t)) out.add(t)
    if (out.size >= limit) break
  }
  return [...out].filter(t => t.length >= 3 && t.length <= 40).slice(0, limit)
}

export function attachListen(server: Server, sheets: Record<string, Sheet>) {
  const wss = new WebSocketServer({ server, path: '/listen' })
  wss.on('connection', (app, req) => {
    const url = new URL(req.url ?? '/listen', 'http://x')
    const sheet = sheets[url.searchParams.get('sheet') ?? '']
    const send = (m: object) => app.readyState === WebSocket.OPEN && app.send(JSON.stringify(m))
    if (!speechEnabled()) {
      send({ type: 'error', error: 'no DEEPGRAM_API_KEY on the server' })
      app.close()
      return
    }

    const q = new URLSearchParams({
      model: 'nova-3',
      language: 'en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      numerals: 'true',
    })
    if (sheet) for (const k of keyterms(sheet)) q.append('keyterm', k)
    const dg = new WebSocket(`${DG_URL}?${q}`, { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } })

    const pending: Buffer[] = []
    const finals: string[] = []
    let interim = ''
    let stopped = false
    let done = false
    const started = Date.now()

    const finish = (why: string) => {
      if (done) return
      done = true
      const text = [...finals, interim].join(' ').replace(/\s+/g, ' ').trim()
      send({ type: 'final', text, why, ms: Date.now() - started })
      if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: 'CloseStream' }))
      setTimeout(() => app.close(), 50)
    }

    dg.on('open', () => {
      for (const b of pending.splice(0)) dg.send(b)
      if (stopped) dg.send(JSON.stringify({ type: 'Finalize' }))
    })
    dg.on('message', raw => {
      let m: any
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }
      if (m.type !== 'Results') return
      const t: string = m.channel?.alternatives?.[0]?.transcript ?? ''
      if (m.is_final) {
        if (t) finals.push(t)
        interim = ''
      } else interim = t
      send({ type: 'interim', text: [...finals, interim].join(' ').trim() })
      if (stopped && m.from_finalize) finish('finalize')
    })
    dg.on('error', err => {
      send({ type: 'error', error: `speech service: ${err.message}` })
      finish('error')
    })
    dg.on('close', () => finish('closed'))

    app.on('message', (data, isBinary) => {
      if (isBinary) {
        const b = data as Buffer
        if (dg.readyState === WebSocket.OPEN) dg.send(b)
        else if (dg.readyState === WebSocket.CONNECTING) pending.push(b)
        return
      }
      let m: any
      try {
        m = JSON.parse(String(data))
      } catch {
        return
      }
      if (m.type === 'stop' && !stopped) {
        stopped = true
        if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: 'Finalize' }))
        setTimeout(() => finish('timeout'), FINAL_WAIT_MS)
      }
    })
    app.on('close', () => {
      if (dg.readyState === WebSocket.OPEN || dg.readyState === WebSocket.CONNECTING) dg.terminate()
    })
  })
  return wss
}
