import { carStock, dubaiUnits, inferSchema, loadCsv, parseCsv, restaurantMenu, SCHEMAS, type Sheet } from '@onhand/shared'
import unitsCsv from '@onhand/shared/fixtures/dubai_units.csv?raw'
import menuCsv from '@onhand/shared/fixtures/restaurant_menu.csv?raw'
import carsCsv from '@onhand/shared/fixtures/car_stock.csv?raw'

// Bundled synthetic sheets for running with no keys and for replay scripts.
// A live Google Sheet, when the server has one, is added with addLive().
export const SHEETS: Record<string, () => Sheet> = {
  [dubaiUnits.id]: () => loadCsv(unitsCsv, dubaiUnits),
  [restaurantMenu.id]: () => loadCsv(menuCsv, restaurantMenu),
  [carStock.id]: () => loadCsv(carsCsv, carStock),
}

/**
 * Registers a live tab read through the server. A known layout ("live-" + a
 * schema id) uses its hand-written schema; any other tab gets one worked out
 * from its columns, the same way the server does it.
 */
export function addLive(id: string, name: string, csv: string): boolean {
  const base = SCHEMAS[id.replace(/^live-/, '')]
  const schema = base ? { ...base, id, name } : inferSchema(parseCsv(csv), id, name)
  let sheet: Sheet
  try {
    sheet = loadCsv(csv, schema)
  } catch {
    return false
  }
  SHEETS[id] = () => sheet
  return true
}
