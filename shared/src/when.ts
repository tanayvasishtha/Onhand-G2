// Spoken day and time for a booking: "tomorrow at 5", "Saturday 11am",
// "on the 28th at 4:30 pm", "next Monday morning". Works on prepare()d text,
// so number words are already digits. Returns local wall-clock parts; the
// Apps Script builds the Date in the calendar's own time zone.

export interface When {
  y: number
  /** 1 to 12. */
  m: number
  d: number
  h: number
  min: number
  /** "Sat 28 Nov, 11:00" for the lens. */
  label: string
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const PARTS: Record<string, number> = { morning: 10, noon: 12, midday: 12, lunch: 13, afternoon: 15, evening: 18, tonight: 19 }

/** Hour without am or pm, as people mean it for a viewing: 1 to 7 is afternoon. */
function guessHour(h: number): number {
  return h >= 1 && h <= 7 ? h + 12 : h
}

export function formatWhen(w: Omit<When, 'label'>): string {
  const date = new Date(w.y, w.m - 1, w.d)
  const day = DAYS[date.getDay()].slice(0, 3)
  const mon = MONTHS[w.m - 1]
  return `${day[0].toUpperCase()}${day.slice(1)} ${w.d} ${mon[0].toUpperCase()}${mon.slice(1)}, ${String(w.h).padStart(2, '0')}:${String(w.min).padStart(2, '0')}`
}

/** Finds a day and a time in the text. Day alone defaults to 11:00; time alone means the next such time. */
export function parseWhen(text: string, now = new Date()): When | null {
  const t = ` ${text.toLowerCase()} `
  let day: Date | null = null
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (/\bday after tomorrow\b/.test(t)) day = new Date(base.getTime() + 2 * 864e5)
  else if (/\btomorrow\b/.test(t)) day = new Date(base.getTime() + 864e5)
  else if (/\b(today|tonight)\b/.test(t)) day = base

  const wd = t.match(/\b(?:next |this |on )?(sun|mon|tues|tue|wednes|wed|thurs|thu|fri|satur|sat)(day)?\b/)
  if (!day && wd) {
    const target = DAYS.findIndex(d => d.startsWith(wd[1].slice(0, 3)))
    let ahead = (target - base.getDay() + 7) % 7
    if (ahead === 0) ahead = 7
    day = new Date(base.getTime() + ahead * 864e5)
  }

  const md = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?: of)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ?? t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?\b/)
  if (!day && md) {
    const [dd, mm] = /^\d/.test(md[1]) ? [Number(md[1]), md[2]] : [Number(md[2]), md[1]]
    const month = MONTHS.indexOf(mm.slice(0, 3))
    day = new Date(base.getFullYear(), month, dd)
    if (day < base) day = new Date(base.getFullYear() + 1, month, dd)
  }
  const nth = t.match(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/)
  if (!day && nth) {
    const dd = Number(nth[1])
    day = new Date(base.getFullYear(), base.getMonth(), dd)
    if (day < base) day = new Date(base.getFullYear(), base.getMonth() + 1, dd)
  }

  let h: number | null = null
  let min = 0
  // prepare() turns "4:30" into "4 30", so a space also separates hours and minutes.
  const tm = t.match(/\b(?:at |@ ?)?(\d{1,2})(?:[:. ](\d{2}))? ?(am|pm|a m|p m)\b/) ?? t.match(/\bat (\d{1,2})(?:[:. ](\d{2}))?\b/) ?? t.match(/\b(\d{1,2})[:.](\d{2})\b/)
  if (tm) {
    h = Number(tm[1])
    min = tm[2] ? Number(tm[2]) : 0
    const ap = tm[3]?.replace(' ', '')
    if (ap === 'pm' && h < 12) h += 12
    else if (ap === 'am' && h === 12) h = 0
    else if (!ap) h = guessHour(h)
  } else {
    const part = Object.keys(PARTS).find(p => new RegExp(`\\b${p}\\b`).test(t))
    if (part) h = PARTS[part]
  }
  if (h == null && !day) return null
  if (h == null || h > 23 || min > 59) h = h != null && h <= 23 ? h : 11
  if (!day) {
    day = base
    if (h * 60 + min <= now.getHours() * 60 + now.getMinutes()) day = new Date(base.getTime() + 864e5)
  }
  const parts = { y: day.getFullYear(), m: day.getMonth() + 1, d: day.getDate(), h, min }
  return { ...parts, label: formatWhen(parts) }
}
