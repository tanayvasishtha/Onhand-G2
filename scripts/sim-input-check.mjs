// Day-1 check: do long press, swipes, taps and the contextual menu reach the
// app in the Even Hub simulator? Drives the simulator's automation API and
// reads the app's [onhand:*] console lines.
//
//   npx evenhub-simulator "http://localhost:5181/?replay=hero" --automation-port 9898
//   node scripts/sim-input-check.mjs

import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.SIM ?? 'http://127.0.0.1:9898'
const OUT = new URL('../out/sim/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const wait = ms => new Promise(r => setTimeout(r, ms))

let since = null
async function drain() {
  const res = await fetch(`${BASE}/api/console${since == null ? '' : `?since_id=${since}`}`).then(r => r.json())
  const lines = []
  for (const e of res.entries ?? []) {
    since = Math.max(since ?? -1, e.id)
    if (/\[onhand:/.test(e.message) || /\[uncaught\]|\[unhandledrejection\]/.test(e.message)) lines.push(e.message.slice(0, 220))
  }
  return lines
}
async function input(action, settle = 700) {
  await fetch(`${BASE}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
  await wait(settle)
  return drain()
}
async function shot(name) {
  const buf = Buffer.from(await fetch(`${BASE}/api/screenshot/glasses`).then(r => r.arrayBuffer()))
  writeFileSync(new URL(`${name}.png`, OUT), buf)
}

const results = []
function record(step, action, lines, expect) {
  const ok = lines.some(l => expect.test(l))
  results.push({ step, action, ok, lines })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}`)
  for (const l of lines) console.log(`      ${l}`)
}

console.log('ping:', await fetch(`${BASE}/api/ping`).then(r => r.text()))
await wait(1500)
await drain()
await shot('01-ready')

// Hold to listen, release to run the next replay line.
let l = await input('long_press', 1200)
await shot('02-listening')
record('long press reaches the app', 'long_press', l, /event\] hold/)
l = await input('long_press_release', 1200)
record('release reaches the app and runs the request', 'long_press_release', l, /event\] release/)
await shot('03-results')

l = await input('down')
record('swipe down reaches the app', 'down', l, /event\] next/)
l = await input('up')
record('swipe up reaches the app', 'up', l, /event\] prev/)
l = await input('click')
record('tap reaches the app (shortlist)', 'click', l, /shortlist=1/)
await shot('04-shortlisted')

// Swipe at the list ends: no overflow scroll should swallow the event.
for (let i = 0; i < 6; i++) l = [...l, ...(await input('down', 400))]
record('repeated swipes at the list end still reach the app', 'down x6', l, /event\] next/)

// Tap then hold: the OS may claim this for its menu; the app must ignore the hold.
await input('click', 200)
l = await input('long_press', 900)
l = [...l, ...(await input('long_press_release', 900))]
record('tap then hold within 600 ms is dropped by the app', 'click+long_press', l, /event\] hold \(dropped\)/)

// Repeated long press: the second line of the replay plays.
l = await input('long_press', 900)
l = [...l, ...(await input('long_press_release', 1200))]
record('second hold plays the next client line', 'long_press x2', l, /heard\] "Actually/)
await shot('05-pets')

l = await input('context_menu', 1200)
record('contextual menu opens (foreground events or menu)', 'context_menu', l, /event\]/)
await shot('06-menu')
l = await input('click', 1200)
record('a click in the open menu sends item 1 (Details)', 'click in menu', l, /event\] menu \{"itemID":1\}/)
await shot('07-details')

writeFileSync(new URL('results.json', OUT), JSON.stringify(results, null, 2))
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in out/sim/`)
process.exitCode = failed ? 1 : 0
