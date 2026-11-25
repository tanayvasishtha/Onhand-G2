import { carStock, dubaiUnits, loadCsv, restaurantMenu, SCHEMAS, type Sheet } from '@onhand/shared'
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

/** Registers a live tab read through the server. Its id is "live-" + the schema id. */
export function addLive(id: string, name: string, csv: string): boolean {
  const base = SCHEMAS[id.replace(/^live-/, '')]
  if (!base) return false
  const schema = { ...base, id, name }
  const sheet = loadCsv(csv, schema)
  SHEETS[id] = () => sheet
  return true
}
