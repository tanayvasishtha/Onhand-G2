import { carStock, dubaiUnits, loadCsv, restaurantMenu, type Sheet } from '@onhand/shared'
import unitsCsv from '@onhand/shared/fixtures/dubai_units.csv?raw'
import menuCsv from '@onhand/shared/fixtures/restaurant_menu.csv?raw'
import carsCsv from '@onhand/shared/fixtures/car_stock.csv?raw'

// Bundled synthetic sheets. From Thursday the live Google Sheet replaces these
// through the backend; they stay as the no-keys replay data.
export const SHEETS: Record<string, () => Sheet> = {
  [dubaiUnits.id]: () => loadCsv(unitsCsv, dubaiUnits),
  [restaurantMenu.id]: () => loadCsv(menuCsv, restaurantMenu),
  [carStock.id]: () => loadCsv(carsCsv, carStock),
}
