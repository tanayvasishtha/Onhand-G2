// Streams WAV files (16 kHz mono s16le) through the server's /listen relay in
// 100 ms frames, like the ring hold does, and prints what comes back.
//   node scripts/speech-check.mjs <sheet> file1.wav [file2.wav ...]
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const SERVER = process.env.ONHAND_SERVER ?? 'ws://localhost:8787'
const [sheet, ...files] = process.argv.slice(2)
const wait = ms => new Promise(r => setTimeout(r, ms))

for (const f of files) {
  const pcm = readFileSync(f).subarray(44)
  const ws = new WebSocket(`${SERVER}/listen?sheet=${sheet}`)
  let interims = 0
  const t0 = Date.now()
  let released = 0
  const done = new Promise(resolve => {
    ws.on('message', raw => {
      const m = JSON.parse(String(raw))
      if (m.type === 'interim') interims++
      else if (m.type === 'final') resolve(m)
      else if (m.type === 'error') resolve(m)
    })
    ws.on('close', () => resolve({ type: 'closed' }))
  })
  await new Promise(r => ws.on('open', r))
  for (let i = 0; i < pcm.length; i += 3200) {
    ws.send(pcm.subarray(i, i + 3200))
    await wait(100)
  }
  released = Date.now()
  ws.send(JSON.stringify({ type: 'stop' }))
  const m = await done
  console.log(`${f.split(/[\/]/).pop()}: ${(pcm.length / 32000).toFixed(1)} s audio, ${interims} interim updates, final ${Date.now() - released} ms after release (${m.why ?? m.type})`)
  console.log(`  heard: ${JSON.stringify(m.text ?? m.error)}`)
}
