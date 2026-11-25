// Scores the parser on requests it was never tuned on. Prints misses.
import { readFileSync } from 'node:fs'
import { loadCsv, SCHEMAS, parse } from '../src/index'
import { describePatch } from '../eval/format'
import { FIXTURE_FILES } from '../eval/sheets'

const sheets: Record<string, ReturnType<typeof loadCsv>> = {}
let n = 0
let ok = 0
for (const line of readFileSync(new URL('../eval/heldout.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [sheet, rest] = line.split('|').map(s => s.trim())
  const [text, want] = rest.split('=>').map(s => s.trim())
  sheets[sheet] ??= loadCsv(readFileSync(new URL(`../fixtures/${FIXTURE_FILES[sheet]}`, import.meta.url), 'utf8'), SCHEMAS[sheet])
  const got = describePatch(parse(text, sheets[sheet])).join('; ')
  const exp = want.split(';').map(s => s.trim()).sort().join('; ')
  n++
  if (got === exp) ok++
  else console.log(`MISS ${text}\n  want ${exp}\n  got  ${got}`)
}
console.log(`held-out: ${ok}/${n}`)
