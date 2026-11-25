// Talks to the Onhand server: speech for one ring hold, and the Claude
// fallback for words the parser could not use. Both are optional: with no
// server or no keys the app still runs on typed text and replay scripts.

import type { Filter, FilterPatch } from '@onhand/shared'

export const SERVER = (import.meta.env.VITE_ONHAND_SERVER as string | undefined) ?? 'http://localhost:8787'

export interface Extra {
  set: Filter[]
  remove: string[]
  note?: string
}

export interface Health {
  speech: boolean
  fallback: boolean
}

export async function health(): Promise<Health | null> {
  try {
    const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok ? ((await res.json()) as Health) : null
  } catch {
    return null
  }
}

export async function askFallback(sheet: string, text: string, patch: FilterPatch): Promise<Extra | null> {
  try {
    const res = await fetch(`${SERVER}/fallback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sheet, text, patch }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const out = (await res.json()) as Extra & { dropped?: string[]; ms?: number }
    console.log(`[onhand:fallback] ${out.ms ?? 0} ms ${JSON.stringify(out)}`)
    return out
  } catch (err) {
    console.warn('[onhand:fallback] failed', err)
    return null
  }
}

/** One hold: open on press, stream PCM, stop on release, resolve with the final text. */
export class Listening {
  private ws: WebSocket
  private queue: Uint8Array[] = []
  private final: Promise<string>
  frames = 0
  last = ''

  constructor(sheet: string, onInterim: (text: string) => void) {
    this.ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/listen?sheet=${encodeURIComponent(sheet)}`)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => {
      for (const b of this.queue.splice(0)) this.ws.send(b)
    }
    this.final = new Promise(resolve => {
      this.ws.onmessage = e => {
        const m = JSON.parse(String(e.data)) as { type: string; text?: string; error?: string }
        if (m.type === 'interim') {
          this.last = m.text ?? ''
          onInterim(this.last)
        } else if (m.type === 'final') {
          console.log(`[onhand:speech] final after ${this.frames} frames: ${JSON.stringify(m.text ?? '')}`)
          resolve(m.text ?? this.last)
        }
        else if (m.type === 'error') console.warn('[onhand:speech]', m.error)
      }
      this.ws.onclose = () => resolve(this.last)
      this.ws.onerror = () => resolve(this.last)
    })
  }

  send(raw: Uint8Array | number[] | string) {
    // The host may hand PCM over as bytes, a number array or base64.
    const pcm = typeof raw === 'string' ? Uint8Array.from(atob(raw), c => c.charCodeAt(0)) : raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
    this.frames++
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm)
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(pcm)
  }

  /** Ends the hold and waits for the final transcript (at most ~2 s). */
  stop(): Promise<string> {
    const sendStop = () => this.ws.send(JSON.stringify({ type: 'stop' }))
    if (this.ws.readyState === WebSocket.OPEN) sendStop()
    else this.ws.addEventListener('open', sendStop)
    return Promise.race([this.final, new Promise<string>(r => setTimeout(() => r(this.last), 2500))])
  }
}
