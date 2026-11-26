import { describe, expect, it } from 'vitest'
import { prepare } from '../src/parse'
import { parseWhen } from '../src/when'

// Thursday 26 Nov 2026, 13:00 local.
const now = new Date(2026, 10, 26, 13, 0)
const at = (text: string) => parseWhen(prepare(text), now)?.label ?? null

describe('spoken day and time for a booking', () => {
  it.each([
    ['tomorrow at 5', 'Fri 27 Nov, 17:00'],
    ['saturday at eleven', 'Sat 28 Nov, 11:00'],
    ['on Saturday 11am', 'Sat 28 Nov, 11:00'],
    ['next monday morning', 'Mon 30 Nov, 10:00'],
    ['on the 3rd at 4:30 pm', 'Thu 3 Dec, 16:30'],
    ['December 2nd at 10', 'Wed 2 Dec, 10:00'],
    ['today at 6 pm', 'Thu 26 Nov, 18:00'],
    ['at 9', 'Fri 27 Nov, 09:00'],
    ['thursday', 'Thu 3 Dec, 11:00'],
  ])('%s -> %s', (text, label) => {
    expect(at(text)).toBe(label)
  })
  it('needs a day or a time', () => {
    expect(at('book a viewing')).toBeNull()
  })
})
