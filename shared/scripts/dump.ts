import { readFileSync } from 'node:fs'
import { loadCsv, SCHEMAS, parse } from '../src/index'
import { describePatch } from '../eval/format'
const files: Record<string, string> = { 'dubai-units': 'dubai_units.csv', 'restaurant-menu': 'restaurant_menu.csv', 'car-stock': 'car_stock.csv' }
const sheets: Record<string, any> = {}
for (const line of readFileSync(new URL('../eval/requests.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [id, text] = line.split('|').map(s => s.trim())
  sheets[id] ??= loadCsv(readFileSync(new URL(`../fixtures/${files[id]}`, import.meta.url), 'utf8'), SCHEMAS[id])
  const p = parse(text, sheets[id])
  console.log(`${id.slice(0, 4)} | ${text}\n     => ${JSON.stringify(describePatch(p))}${p.unparsed ? '  unparsed: ' + p.unparsed : ''}`)
}
