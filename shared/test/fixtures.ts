import { readFileSync } from 'node:fs'
import { loadCsv } from '../src/sheet'
import { carStock, dubaiUnits, restaurantMenu } from '../src/schemas'

const read = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')

export const units = loadCsv(read('dubai_units.csv'), dubaiUnits)
export const menu = loadCsv(read('restaurant_menu.csv'), restaurantMenu)
export const cars = loadCsv(read('car_stock.csv'), carStock)
