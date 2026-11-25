// Scripted client lines for replay mode (no keys, no mic). Each hold and
// release on the ring plays the next line as if it had been heard. Open the
// app with ?replay=hero (or menu, cars) to use one.

export const SCRIPTS: Record<string, { sheet: string; lines: string[] }> = {
  hero: {
    sheet: 'dubai-units',
    lines: [
      'Two-bed in Marina, under two and a half, sea view',
      'Actually, it has to allow pets',
      'What about three bed under two?',
      'Forget the view',
      'Start over. Studio in JVC under 700k, ready to move in',
    ],
  },
  menu: {
    sheet: 'restaurant-menu',
    lines: ['Does the risotto have nuts?', 'Something vegan with no nuts', 'Cheapest dessert without dairy'],
  },
  cars: {
    sheet: 'car-stock',
    lines: ['A white SUV under 90k', '2022 or newer with under 50,000 km', 'Show me the cheapest'],
  },
}

export class Replay {
  private i = 0
  constructor(private lines: string[]) {}
  next(): string {
    return this.lines[this.i++] ?? ''
  }
  get left(): number {
    return this.lines.length - this.i
  }
}
