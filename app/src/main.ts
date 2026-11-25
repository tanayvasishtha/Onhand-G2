import { parse } from '@onhand/shared'
import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { GestureFilter, toGesture, type Gesture } from './input'
import { MENU, Session } from './session'
import { Replay, SCRIPTS } from './replay'
import { SHEETS } from './sheets'
import { askFallback, health, Listening, type Health } from './speech'
import { logEvent, mountUi, pendingText, setLens, setMic, setStatus } from './ui'

const LENS_ID = 1
const LENS_NAME = 'lens'

const params = new URLSearchParams(location.search)
const script = SCRIPTS[params.get('replay') ?? '']
const replay = script ? new Replay(script.lines) : null
let session = new Session(SHEETS[script?.sheet ?? 'dubai-units'](), true)
let bridge: EvenAppBridge | null = null
const filter = new GestureFilter()

// Mic frames go to the server only while the ring is held; the rest are dropped.
let frames = 0
let listening: Listening | null = null
let server: Health | null = null
let busy = false

/** Parses locally, and asks Claude only about the words the parser could not use. */
async function understand(text: string) {
  if (!server?.fallback || !text.trim()) return null
  const patch = parse(text, session.sheet)
  if (!patch.unparsed.trim()) return null
  return askFallback(session.sheet.schema.id, text, patch)
}

mountUi(
  Object.entries(SHEETS).map(([id, load]) => ({ id, name: load().schema.name })),
  {
    onSubmit: async text => {
      session.submit(text, await understand(text))
      render()
    },
    onSheet: id => {
      session = new Session(SHEETS[id](), true)
      render()
    },
    onKey: (kind, id) => handle(kind === 'menu' ? { kind, id: id!, source: -1 } : { kind, source: -1 }),
  },
)

function handle(g: Gesture) {
  if (busy) return
  switch (g.kind) {
    case 'tap':
      session.tap()
      break
    case 'next':
      session.move(1)
      break
    case 'prev':
      session.move(-1)
      break
    case 'hold':
      frames = 0
      session.holdStart()
      // Typed text and replay lines stand in for speech; otherwise stream the mic.
      listening = server?.speech && !replay && !hasTyped()
        ? new Listening(session.sheet.schema.id, text => {
            session.heard = text
            render()
          })
        : null
      break
    case 'release':
      void release()
      return
    case 'menu':
      session.menu(g.id)
      break
    case 'exit':
      // Platform contract: double tap on the root page opens the system exit dialog.
      bridge?.shutDownPageContainer(1)
      return
    case 'system-exit':
      cleanup()
      return
  }
  render()
}

async function release() {
  setMic(frames ? `mic: ${frames} frames, ${(frames / 10).toFixed(1)} s` : '')
  busy = true
  try {
    let heard = pendingText() || replay?.next() || ''
    if (listening) {
      const l = listening
      listening = null
      session.heard = session.heard || '...'
      render()
      heard = (await l.stop()) || heard
    }
    console.log(`[onhand:heard] ${JSON.stringify(heard)}`)
    session.holdEnd(heard, await understand(heard))
  } finally {
    busy = false
    render()
  }
}

function hasTyped() {
  const el = document.querySelector<HTMLInputElement>('#req')
  return !!el?.value.trim()
}

// Glasses writes are debounced: the BLE render queue takes 80 to 165 ms per write.
let shown = ''
let pending = ''
let timer: number | null = null
function render() {
  pending = session.render()
  setLens(pending)
  if (!bridge || timer !== null) return
  timer = window.setTimeout(async () => {
    timer = null
    if (pending === shown || !bridge) return
    shown = pending
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: LENS_ID, containerName: LENS_NAME, content: shown }))
  }, 120)
}

function cleanup() {
  bridge?.audioControl(false)
}

async function connect(): Promise<EvenAppBridge | null> {
  const timeout = new Promise<null>(r => setTimeout(() => r(null), 3000))
  return Promise.race([waitForEvenAppBridge(), timeout])
}

render()
server = await health()
console.log(`[onhand:server] ${JSON.stringify(server)}`)
logEvent(server ? `server: speech ${server.speech ? 'on' : 'off'}, fallback ${server.fallback ? 'on' : 'off'}` : 'no server: typed text and replay only')
if (script) logEvent(`replay "${params.get('replay')}": each hold and release plays the next line`)
bridge = await connect()
if (!bridge) {
  setStatus('mirror', 'Browser mirror, no glasses')
  logEvent('no Even bridge: keys work here (Space hold, Enter tap, arrows swipe, 1-5 menu)')
} else {
  const first = session.render()
  const lens = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 4,
    containerID: LENS_ID,
    containerName: LENS_NAME,
    content: first,
    isEventCapture: 1,
  })
  const menu = new MenuContainerProperty({ menuItems: MENU.map(m => new MenuItemProperty({ ...m })) })
  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [lens], menuObject: menu }),
  )
  if (created !== 0) {
    // A plain browser also resolves the bridge, then refuses the page (1).
    setStatus(created === 1 ? 'mirror' : 'error', created === 1 ? 'Browser mirror, no glasses' : `Page create failed: ${created}`)
  } else {
    shown = first
    setStatus('live', 'Glasses connected')
    console.log('[onhand:ready] page created')
  }

  bridge.onEvenHubEvent(event => {
    if (event.audioEvent?.audioPcm) {
      if (session.listening) {
        frames++
        listening?.send(event.audioEvent.audioPcm)
      }
      return
    }
    const raw = JSON.stringify(event.jsonData ?? event)
    const g = toGesture(event)
    const ok = g ? filter.accept(g) : false
    // Logged for the day-1 input check (simulator automation reads the console).
    console.log(`[onhand:event] ${g ? g.kind : 'ignored'}${g && !ok ? ' (dropped)' : ''} ${raw}`)
    if (!g) return
    logEvent(`${g.kind}${g.kind === 'menu' ? ' ' + g.id : ''} src=${g.source}${ok ? '' : ' (dropped)'}`)
    if (ok) {
      handle(g)
      console.log(`[onhand:screen] ${session.screen} hl=${session.highlight} shortlist=${session.shortlist.size}`)
    }
  })

  // Open the mic once; frames are gated in the app so the first words are not lost.
  try {
    await bridge.audioControl(true)
    console.log('[onhand:mic] on')
  } catch (err) {
    console.warn('[onhand:mic] failed', err)
  }
}

window.addEventListener('beforeunload', cleanup)
