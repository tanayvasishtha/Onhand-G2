// Writes eval/cases.json from eval/requests.txt using the current parser.
// Run it only after reading every line of the dump by hand: the file becomes
// the expected answers.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadCsv, SCHEMAS, parse } from '../src/index'
import { describePatch } from '../eval/format'
import { FIXTURE_FILES } from '../eval/sheets'

const out: { sheet: string; text: string; expect: string[]; unparsed: string }[] = []
const sheets: Record<string, ReturnType<typeof loadCsv>> = {}
for (const line of readFileSync(new URL('../eval/requests.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [sheet, text] = line.split('|').map(s => s.trim())
  sheets[sheet] ??= loadCsv(readFileSync(new URL(`../fixtures/${FIXTURE_FILES[sheet]}`, import.meta.url), 'utf8'), SCHEMAS[sheet])
  const p = parse(text, sheets[sheet])
  out.push({ sheet, text, expect: describePatch(p), unparsed: p.unparsed })
}
writeFileSync(new URL('../eval/cases.json', import.meta.url), JSON.stringify(out, null, 1) + '\n')
console.log(`${out.length} cases written`)
