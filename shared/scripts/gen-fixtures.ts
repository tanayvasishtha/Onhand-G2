// Writes the three synthetic starter sheets into shared/fixtures/.
// Seeded, so the output is the same on every run. Every project, unit, dish,
// stock number and price is invented. Formats are mixed on purpose, the way a
// real team sheet drifts over time.
//
//   npm run gen:fixtures

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCsv } from '../src/sheet'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = rng(20261124)
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1))
const chance = (p: number) => rand() < p
const comma = (n: number) => n.toLocaleString('en-US')

// ---------------------------------------------------------------- Dubai units

interface AreaSpec {
  names: string[]
  psf: number
  views: [string, number][]
  projects: string[]
  sea?: boolean
}

const AREAS: Record<string, AreaSpec> = {
  'Dubai Marina': {
    names: ['Dubai Marina', 'Marina', 'dubai marina', 'Dubai Marina '],
    psf: 1850,
    views: [['Sea', 0.12], ['Marina', 0.05], ['City', 0]],
    projects: ['Harbour Crest', 'Sail Point', 'Marina Lumen', 'Seawind Tower', 'Quayside 21'],
    sea: true,
  },
  JVC: {
    names: ['JVC', 'Jumeirah Village Circle', 'jvc'],
    psf: 1080,
    views: [['Community', 0], ['Park', 0.04], ['Pool', 0.03]],
    projects: ['Circle Park Lofts', 'Oakridge Court', 'Verdant Heights', 'Lumina Gardens'],
  },
  Downtown: {
    names: ['Downtown', 'Downtown Dubai'],
    psf: 2550,
    views: [['Burj', 0.15], ['City', 0], ['Community', -0.03]],
    projects: ['Boulevard Nine', 'Fountain Row', 'Opera Lane', 'Skyline Court'],
  },
  'Business Bay': {
    names: ['Business Bay', 'business bay'],
    psf: 1900,
    views: [['Canal', 0.05], ['Burj', 0.1], ['City', 0]],
    projects: ['Canal Point', 'Bayside Works', 'Waterline House'],
  },
  JLT: {
    names: ['JLT', 'Jumeirah Lake Towers', 'Jumeirah Lakes Towers'],
    psf: 1300,
    views: [['Lake', 0.03], ['Community', 0], ['Marina', 0.05]],
    projects: ['Cluster Pearl', 'Lakeshore Tower', 'Lakeview Arc'],
  },
  'Palm Jumeirah': {
    names: ['Palm Jumeirah', 'Palm', 'The Palm'],
    psf: 3300,
    views: [['Sea', 0.12], ['Community', 0]],
    projects: ['Frond Residences', 'Crescent Shore', 'Palm Atrium'],
    sea: true,
  },
  'Dubai Hills': {
    names: ['Dubai Hills', 'Dubai Hills Estate'],
    psf: 2050,
    views: [['Golf', 0.1], ['Park', 0.04], ['Community', 0]],
    projects: ['Hillcrest Park', 'Fairway Rise', 'Greenway Terraces'],
  },
  'Creek Harbour': {
    names: ['Creek Harbour', 'Dubai Creek Harbour', 'Creek Harbor'],
    psf: 2100,
    views: [['Creek', 0.06], ['City', 0], ['Burj', 0.08]],
    projects: ['Heron Quay', 'Tidewater Creek', 'Creekline Terraces'],
  },
  Arjan: {
    names: ['Arjan', 'arjan'],
    psf: 1050,
    views: [['Community', 0], ['Pool', 0.03]],
    projects: ['Arjan Bloom', 'Garden Mile'],
  },
  'Al Furjan': {
    names: ['Al Furjan', 'Furjan'],
    psf: 1200,
    views: [['Community', 0], ['Park', 0.03]],
    projects: ['Furjan Square', 'Pavilion Grove'],
  },
}

const AREA_WEIGHTS: [string, number][] = [
  ['Dubai Marina', 46],
  ['JVC', 34],
  ['Downtown', 26],
  ['Business Bay', 26],
  ['JLT', 20],
  ['Palm Jumeirah', 16],
  ['Dubai Hills', 22],
  ['Creek Harbour', 22],
  ['Arjan', 18],
  ['Al Furjan', 20],
]

const DEVELOPERS = ['Northgate Developments', 'Azure Sands', 'Meridian Homes', 'Falconry Properties', 'Sahra Living', 'Qasr Estates']
const SIZE: Record<number, [number, number]> = { 0: [380, 520], 1: [650, 900], 2: [1000, 1420], 3: [1450, 2100], 4: [2300, 3400] }
const NOTES = ['', '', '', '', 'Vacant on transfer', 'Tenanted till Mar 2027', 'Upgraded kitchen', 'Corner unit', 'Motivated seller', 'Balcony 120 sqft', 'High floor', 'Maid room', 'Two parking bays']

function pickWeighted<T>(xs: [T, number][]): T {
  const total = xs.reduce((s, [, w]) => s + w, 0)
  let x = rand() * total
  for (const [v, w] of xs) {
    x -= w
    if (x <= 0) return v
  }
  return xs[xs.length - 1][0]
}

function priceText(p: number): string {
  const m = p / 1e6
  const short = String(Number(m.toFixed(3)))
  return pick([comma(p), comma(p), `${short}M`, `AED ${short}m`, String(p), `${short} mn`, `AED ${comma(p)}`])
}

function bedsText(b: number): string {
  if (b === 0) return pick(['Studio', 'studio', 'Studio'])
  if (b >= 3 && chance(0.2)) return `${b}BR + Maid`
  return pick([`${b}BR`, `${b} Bed`, String(b), `${b} B/R`, `${b}BR`])
}

function handoverText(): { text: string; offplan: boolean } {
  if (chance(0.45)) return { text: pick(['Ready', 'Ready', 'ready', 'Completed']), offplan: false }
  const year = int(2026, 2029)
  const q = year === 2026 ? int(2, 4) : year === 2029 ? int(1, 2) : int(1, 4)
  const month = ['Mar', 'Jun', 'Sep', 'Dec'][q - 1]
  return { text: pick([`Q${q} ${year}`, `Q${q}-${String(year).slice(2)}`, `${month} ${year}`, `Q${q} ${year}`]), offplan: true }
}

function boolText(v: boolean | null): string {
  if (v == null) return ''
  return v ? pick(['Yes', 'Yes', 'Y', 'yes']) : pick(['No', 'No', 'N', 'no'])
}

function dubaiUnits(): string {
  const header = ['Project', 'Unit', 'Area', 'Bedrooms', 'Size (sqft)', 'Price (AED)', 'Handover', 'View', 'Pets', 'Furnished', 'Floor', 'Payment Plan', 'Developer', 'Notes']
  const rows: string[][] = []
  const used = new Set<string>()
  const devOf = new Map<string, string>()

  while (rows.length < 246) {
    const area = pickWeighted(AREA_WEIGHTS)
    const spec = AREAS[area]
    const project = pick(spec.projects)
    const beds = pickWeighted<number>([[0, 12], [1, 33], [2, 30], [3, 18], [4, 7]])
    const floor = int(2, area === 'Palm Jumeirah' ? 18 : 58)
    const unit = String(floor * 100 + int(1, 12)).padStart(4, '0')
    if (used.has(`${project}|${unit}`)) continue
    used.add(`${project}|${unit}`)
    const [view, premium] = pick(spec.views)
    const [lo, hi] = SIZE[beds]
    const size = Math.round(between(lo, hi) / 5) * 5
    const ho = handoverText()
    const factor = between(0.88, 1.12) * (1 + premium) * (1 + floor / 400) * (ho.offplan ? 0.96 : 1)
    const price = Math.round((size * spec.psf * factor) / 5000) * 5000
    if (!devOf.has(project)) devOf.set(project, pick(DEVELOPERS))
    const pets = chance(0.15) ? null : chance(0.55)
    const furnished = chance(0.1) ? null : chance(0.35)
    const plan = ho.offplan ? pick(['60/40', '70/30 post-handover', '50/50', '1% monthly', '80/20']) : pick(['Cash or mortgage', 'Cash', 'Mortgage ok'])
    rows.push([
      project,
      unit,
      pick(spec.names),
      bedsText(beds),
      pick([comma(size), `${size} sqft`, comma(size), `${comma(size)} sq ft`]),
      priceText(price),
      ho.text,
      view,
      boolText(pets),
      boolText(furnished),
      String(floor),
      plan,
      devOf.get(project)!,
      pick(NOTES),
    ])
  }

  // Hero rows for the demo story, written by hand: three 2BR sea-view units in
  // the Marina under 2.5M (one without pets), and a 3BR that sits just over 2M.
  const hero: string[][] = [
    ['Harbour Crest', '1804', 'Dubai Marina', '2BR', '1,210', '2,350,000', 'Q3-26', 'Sea', 'Yes', 'No', '18', '60/40', devOf.get('Harbour Crest') ?? 'Azure Sands', 'Vacant on transfer'],
    ['Seawind Tower', '2210', 'Marina', '2 Bed', '1,180 sqft', 'AED 2.48m', 'Ready', 'Sea', 'No', 'Yes', '22', 'Cash or mortgage', devOf.get('Seawind Tower') ?? 'Meridian Homes', 'Tenanted till Mar 2027'],
    ['Sail Point', '0907', 'Dubai Marina', '2', '1,150', '2.29M', 'Q1 2027', 'Sea', 'Yes', 'No', '9', '70/30 post-handover', devOf.get('Sail Point') ?? 'Northgate Developments', 'Corner unit'],
    ['Marina Lumen', '2205', 'dubai marina', '3BR', '1,620', '2,180,000', 'Q2 2028', 'City', '', 'No', '22', '50/50', devOf.get('Marina Lumen') ?? 'Sahra Living', 'Motivated seller'],
  ]
  const at = [39, 85, 10, 31]
  hero.forEach((h, i) => rows.splice(at[i], 0, h))

  // Unreadable prices, as a real sheet has: these rows are skipped and reported.
  rows.splice(53, 0, ['Opera Lane', '3302', 'Downtown', '2BR', '1,300', 'TBC', 'Ready', 'Burj', 'No', 'Yes', '33', 'Cash', 'Qasr Estates', 'Price on request'])
  rows.splice(88, 0, ['Arjan Bloom', '0611', 'Arjan', '1BR', '720', 'call', 'Q4 2027', 'Pool', 'Yes', 'No', '6', '60/40', 'Sahra Living', ''])
  rows.splice(140, 0, ['Fairway Rise', '1508', 'Dubai Hills', '3BR', '1,880', '', 'Q3 2027', 'Golf', 'Yes', '', '15', '70/30 post-handover', 'Meridian Homes', 'Owner travelling'])
  rows.splice(201, 0, ['Lakeview Arc', '2711', 'JLT', '1 Bed', '760', 'on request', 'Ready', 'Lake', '', 'No', '27', 'Cash', 'Azure Sands', ''])

  // Duplicates: a unit re-listed later with a new price. The later row wins.
  for (const i of [20, 60, 120, 170]) {
    const dup = [...rows[i]]
    dup[5] = comma(Math.round((parsePrice(dup[5]) * 0.97) / 5000) * 5000)
    dup[13] = 'Price reduced'
    rows.push(dup)
  }

  const lines = [header, ...rows]
  return toCsv(lines)
}

function parsePrice(s: string): number {
  const t = s.toLowerCase().replace(/aed|,/g, '').trim()
  const m = t.match(/([\d.]+)\s*(m|mn)?/)
  if (!m) return 0
  return Number(m[1]) * (m[2] ? 1e6 : 1)
}

// ---------------------------------------------------------- Restaurant menu

type Dish = [string, string, number, string, boolean | null, boolean | null, number, string?]

// [dish, section, price AED, allergens as written, vegetarian, vegan, spice 0-3, notes]
const MENU: Dish[] = [
  ['Burrata and heirloom tomato', 'Starters', 68, 'Dairy', true, false, 0],
  ['Calamari fritti', 'Starters', 58, 'Gluten, shellfish, egg', false, false, 0],
  ['Beef carpaccio', 'Starters', 72, 'Dairy; mustard', false, false, 0],
  ['Arancini trio', 'Starters', 49, 'gluten, dairy, egg', true, false, 0],
  ['Smoked salmon crostini', 'Starters', 55, 'Fish, gluten, dairy', false, false, 0],
  ['Hummus and za’atar flatbread', 'Starters', 39, 'Sesame, gluten', true, true, 0],
  ['Chilli prawns', 'Starters', 64, 'Shellfish', false, false, 2],
  ['Caesar salad', 'Salads', 52, 'Egg, fish, dairy, gluten', false, false, 0],
  ['Quinoa and roast squash', 'Salads', 48, 'None', true, true, 0],
  ['Fattoush', 'Salads', 42, 'Gluten', true, true, 0],
  ['Rocket, pear and walnut', 'Salads', 46, 'Walnuts, dairy', true, false, 0],
  ['Risotto alla Milanese', 'Risotto', 82, 'Dairy, celery', true, false, 0],
  ['Risotto ai funghi', 'Risotto', 86, 'Pine nuts, dairy', true, false, 0, 'Truffle oil, toasted pine nuts on top'],
  ['Seafood risotto', 'Risotto', 98, 'Shellfish, fish, dairy, celery', false, false, 0],
  ['Pumpkin risotto (vegan)', 'Risotto', 78, 'Celery', true, true, 0, 'Made with oat cream'],
  ['Spaghetti carbonara', 'Pasta', 74, 'Gluten, egg, dairy', false, false, 0, 'Beef bacon'],
  ['Penne arrabbiata', 'Pasta', 58, 'Gluten', true, true, 2],
  ['Pesto genovese', 'Pasta', 69, 'Gluten, pine nuts, dairy', true, false, 0],
  ['Lobster linguine', 'Pasta', 145, 'Gluten, shellfish, dairy', false, false, 1],
  ['Gnocchi sorrentina', 'Pasta', 66, 'gluten; dairy; egg', true, false, 0],
  ['Gluten-free penne pomodoro', 'Pasta', 62, '', true, true, 0, 'GF pasta, ask kitchen to confirm'],
  ['Lasagne al forno', 'Pasta', 79, 'Gluten, dairy, egg, celery', false, false, 0],
  ['Margherita', 'Pizza', 55, 'Gluten, dairy', true, false, 0],
  ['Diavola', 'Pizza', 68, 'Gluten, dairy', false, false, 2, 'Beef pepperoni'],
  ['Quattro formaggi', 'Pizza', 72, 'Gluten, dairy', true, false, 0],
  ['Pistachio mortadella pizza', 'Pizza', 84, 'Gluten, dairy, pistachio', false, false, 0],
  ['Vegan garden pizza', 'Pizza', 64, 'Gluten, soy', true, true, 0, 'Soy cheese'],
  ['Truffle mushroom pizza', 'Pizza', 89, 'Gluten, dairy', true, false, 0],
  ['Grilled sea bass', 'Grill', 128, 'Fish', false, false, 0],
  ['Ribeye 300g', 'Grill', 185, 'Dairy', false, false, 0, 'Herb butter on the side'],
  ['Chicken milanese', 'Grill', 92, 'Gluten, egg, dairy', false, false, 0],
  ['Lamb chops', 'Grill', 158, 'Mustard', false, false, 1],
  ['Salmon teriyaki', 'Grill', 118, 'Fish, soy, sesame', false, false, 0],
  ['Spiced chicken skewers', 'Grill', 84, 'Dairy', false, false, 2, 'Yoghurt marinade'],
  ['Grilled halloumi plate', 'Grill', 72, 'Dairy', true, false, 0],
  ['Satay tofu bowl', 'Grill', 69, 'Peanuts, soy, sesame', true, true, 1],
  ['Tiramisu', 'Desserts', 45, 'Gluten, egg, dairy', true, false, 0],
  ['Panna cotta', 'Desserts', 39, 'Dairy', true, false, 0],
  ['Chocolate fondant', 'Desserts', 48, 'Gluten, egg, dairy, hazelnut', true, false, 0],
  ['Pistachio gelato', 'Desserts', 34, 'Pistachio, dairy', true, false, 0],
  ['Lemon sorbet', 'Desserts', 28, 'None', true, true, 0],
  ['Baklava', 'Desserts', 36, 'Gluten, walnuts, pistachio', true, false, 0],
  ['Affogato', 'Desserts', 32, 'Dairy', true, false, 0],
  ['Fruit plate', 'Desserts', 38, '-', true, true, 0],
  ['Almond cake', 'Desserts', 39, 'Almonds, egg, dairy', true, false, 0],
  ['Fresh orange juice', 'Drinks', 26, '', true, true, 0],
  ['Mint lemonade', 'Drinks', 24, 'None', true, true, 0],
  ['Iced latte', 'Drinks', 28, 'Dairy', true, false, 0, 'Oat milk on request'],
  ['Pistachio shake', 'Drinks', 34, 'Pistachio, dairy', true, false, 0],
  ['Espresso', 'Drinks', 16, 'None', true, true, 0],
  ['Sparkling water', 'Drinks', 18, 'None', true, true, 0],
  ['Mushroom soup', 'Starters', 44, 'Dairy, celery', true, false, 0],
  ['Lentil soup', 'Starters', 36, 'Celery', true, true, 1],
  ['Prawn tempura', 'Starters', 62, 'Shellfish, gluten, egg', false, false, 0],
  ['Bruschetta', 'Starters', 38, 'Gluten', true, true, 0],
  ['Kids pasta butter', 'Pasta', 35, 'Gluten, dairy', true, false, 0],
  ['Kids chicken bites', 'Grill', 42, 'Gluten, egg', false, false, 0],
  ['Truffle fries', 'Starters', 32, 'Dairy', true, false, 0, 'Parmesan on top'],
  ['Sesame green beans', 'Salads', 34, 'Sesame, soy', true, true, 1],
  ['Prawn and avocado salad', 'Salads', 64, 'Shellfish, egg', false, false, 0],
]

function restaurantMenu(): string {
  const header = ['Dish', 'Section', 'Price (AED)', 'Allergens', 'Vegetarian', 'Vegan', 'Spice (0-3)', 'Notes']
  const rows = MENU.map(([dish, section, price, allergens, veg, vegan, spice, notes]) => [
    dish.replace('’', "'"),
    section,
    pick([String(price), `AED ${price}`, `${price}.00`, String(price)]),
    allergens,
    boolText(veg),
    boolText(vegan),
    String(spice),
    notes ?? '',
  ])
  return toCsv([header, ...rows])
}

// ----------------------------------------------------------------- Car stock

const MODELS: [string, string, string, number][] = [
  // make, model, body, price new-ish (AED)
  ['Toyota', 'Land Cruiser GXR', 'SUV', 310000],
  ['Toyota', 'Prado VX', 'SUV', 215000],
  ['Toyota', 'RAV4 Hybrid', 'SUV', 125000],
  ['Toyota', 'Camry', 'Sedan', 105000],
  ['Toyota', 'Corolla', 'Sedan', 78000],
  ['Toyota', 'Hilux', 'Pickup', 110000],
  ['Nissan', 'Patrol LE', 'SUV', 290000],
  ['Nissan', 'X-Trail', 'SUV', 98000],
  ['Nissan', 'Altima', 'Sedan', 88000],
  ['Lexus', 'LX 600', 'SUV', 520000],
  ['Lexus', 'RX 350', 'SUV', 245000],
  ['Lexus', 'ES 300h', 'Sedan', 190000],
  ['Mitsubishi', 'Pajero', 'SUV', 115000],
  ['Hyundai', 'Tucson', 'SUV', 92000],
  ['Hyundai', 'Elantra', 'Sedan', 68000],
  ['Kia', 'Sportage', 'SUV', 95000],
  ['Kia', 'Picanto', 'Hatchback', 45000],
  ['Ford', 'Ranger', 'Pickup', 118000],
  ['Ford', 'Mustang', 'Coupe', 175000],
  ['Honda', 'Civic', 'Sedan', 82000],
  ['Honda', 'CR-V', 'SUV', 112000],
  ['Mercedes', 'GLE 450', 'SUV', 390000],
  ['Mercedes', 'C 200', 'Sedan', 210000],
  ['BMW', 'X5 xDrive40i', 'SUV', 380000],
  ['BMW', '320i', 'Sedan', 185000],
  ['Tesla', 'Model Y', 'SUV', 190000],
  ['Tesla', 'Model 3', 'Sedan', 165000],
]

function carStock(): string {
  const header = ['Stock #', 'Vehicle', 'Make', 'Body', 'Year', 'Colour', 'Price (AED)', 'Mileage (km)', 'Fuel', 'Location', 'Notes']
  const rows: string[][] = []
  for (let i = 0; i < 80; i++) {
    const [make, model, body, base] = pick(MODELS)
    const year = int(2018, 2025)
    const age = 2026 - year
    const price = Math.round((base * Math.pow(0.86, age) * between(0.92, 1.08)) / 500) * 500
    const km = Math.round((age * between(9000, 22000)) / 100) * 100 + int(0, 3000)
    const fuel = make === 'Tesla' ? 'Electric' : /Hybrid|300h/.test(model) ? 'Hybrid' : model === 'Hilux' || model === 'Ranger' ? pick(['Diesel', 'Petrol']) : 'Petrol'
    rows.push([
      `ST-${String(4100 + i * 7)}`,
      `${make} ${model}`,
      make,
      pick([body, body, body.toLowerCase()]),
      String(year),
      pick(['White', 'White', 'Pearl White', 'Black', 'Silver', 'Grey', 'Gray', 'Blue', 'Red', 'Beige']),
      pick([comma(price), `AED ${comma(price)}`, `${Number((price / 1000).toFixed(1))}k`, String(price)]),
      pick([`${comma(km)} km`, String(km), comma(km)]),
      fuel,
      pick(['Al Quoz', 'Deira', 'Sharjah', 'Al Quoz']),
      pick(['', '', '', 'GCC spec', 'Full service history', 'One owner', 'Under warranty', 'Minor scratch rear bumper']),
    ])
  }
  // Hero shot: a white SUV under 90k exists, with two more close by.
  rows.splice(12, 0, ['ST-4999', 'Hyundai Tucson', 'Hyundai', 'SUV', '2022', 'White', 'AED 84,500', '48,200 km', 'Petrol', 'Al Quoz', 'GCC spec'])
  rows.splice(40, 0, ['ST-5006', 'Kia Sportage', 'Kia', 'SUV', '2021', 'Pearl White', '79.5k', '61200', 'Petrol', 'Deira', 'One owner'])
  rows.splice(64, 0, ['ST-5013', 'Nissan X-Trail', 'Nissan', 'suv', '2022', 'White', '88,000', '39,900 km', 'Petrol', 'Sharjah', ''])
  return toCsv([header, ...rows])
}

writeFileSync(join(OUT, 'dubai_units.csv'), dubaiUnits())
writeFileSync(join(OUT, 'restaurant_menu.csv'), restaurantMenu())
writeFileSync(join(OUT, 'car_stock.csv'), carStock())
console.log('wrote dubai_units.csv, restaurant_menu.csv, car_stock.csv to', OUT)
