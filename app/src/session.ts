import {
  applyPatch,
  compareScreen,
  detailScreen,
  listeningScreen,
  parse,
  readyScreen,
  recapScreen,
  resultsScreen,
  run,
  type Query,
  type Result,
  type Sheet,
  type ViewState,
} from '@onhand/shared'
import type { Extra } from './speech'

export type Screen = 'ready' | 'listening' | 'results' | 'detail' | 'compare' | 'recap'

export const MENU = [
  { itemID: 1, itemName: 'Details' },
  { itemID: 2, itemName: 'Undo last filter' },
  { itemID: 3, itemName: 'Compare 1 and 2' },
  { itemID: 4, itemName: 'Clear filters' },
  { itemID: 5, itemName: 'End meeting' },
] as const

/** One meeting: the filters built up so far, the rows on screen and the shortlist. */
export class Session {
  query: Query = { filters: [] }
  result: Result | null = null
  highlight = 0
  shortlist = new Set<number>()
  listening = false
  heard = ''
  screen: Screen = 'ready'
  private before: Screen = 'ready'
  private compared: [number, number] = [0, 1]
  private history: Query[] = []
  private flash = ''
  requests = 0
  transcript: string[] = []
  /** Last line of the recap screen: where the shortlist went. */
  exportNote = 'export not set up'

  constructor(public sheet: Sheet, public replay = false) {}

  private view(): ViewState {
    return {
      sheet: this.sheet,
      query: this.query,
      result: this.result,
      highlight: this.highlight,
      shortlist: this.shortlist,
      listening: this.listening,
      heard: this.heard,
      flash: this.flash || undefined,
      replay: this.replay,
    }
  }

  render(): string {
    const v = this.view()
    this.flash = ''
    switch (this.screen) {
      case 'ready':
        return readyScreen(v)
      case 'listening':
        return listeningScreen(v)
      case 'results':
        return resultsScreen(v)
      case 'detail':
        return detailScreen(v)
      case 'compare':
        return compareScreen(v, ...this.compared)
      case 'recap':
        return recapScreen(v, this.requests, this.exportNote)
    }
  }

  /** Runs one request. `extra` holds filters the Claude fallback found in the leftover words. */
  submit(text: string, extra?: Extra | null) {
    const t = text.trim()
    if (!t) return
    this.requests++
    this.transcript.push(t)
    const patch = parse(t, this.sheet)
    if (extra) {
      patch.set = [...patch.set, ...extra.set]
      patch.remove = [...patch.remove, ...extra.remove]
      if (extra.set.length || extra.remove.length) patch.unparsed = ''
    }
    const changesFilters = patch.clear || patch.set.length || patch.remove.length || patch.sort
    if (changesFilters) {
      this.history.push(this.query)
      this.query = applyPatch(this.query, patch)
      this.refresh()
    }
    const cmd = patch.command
    if (cmd?.kind === 'compare') return this.compare(cmd.a, cmd.b)
    if (cmd?.kind === 'detail') {
      if (this.result?.hits[cmd.index]) {
        this.highlight = cmd.index
        this.screen = 'detail'
      }
      return
    }
    if (cmd?.kind === 'count') this.flash = this.result ? `${this.result.total} rows match` : 'no filters yet'
    if (extra?.note) this.flash = extra.note
    else if (!changesFilters && !cmd) this.flash = patch.unparsed ? `not understood: ${patch.unparsed}` : 'nothing to change'
    this.screen = this.result ? 'results' : 'ready'
  }

  private refresh() {
    this.result = this.query.filters.length || this.query.sort ? run(this.sheet.rows, this.sheet.schema, this.query) : null
    this.highlight = 0
  }

  tap() {
    if (this.screen === 'detail' || this.screen === 'compare') {
      this.screen = 'results'
      return
    }
    if (this.screen !== 'results' || !this.result?.hits.length) return
    const r = this.result.hits[this.highlight].row.r
    if (this.shortlist.has(r)) this.shortlist.delete(r)
    else this.shortlist.add(r)
  }

  move(step: 1 | -1) {
    if (this.screen === 'detail' || this.screen === 'compare') {
      this.screen = 'results'
      return
    }
    const n = this.result?.hits.length ?? 0
    if (this.screen !== 'results' || !n) return
    this.highlight = (this.highlight + step + n) % n
  }

  holdStart() {
    if (this.screen === 'recap') this.reset()
    this.before = this.screen === 'listening' ? this.before : this.screen
    this.listening = true
    this.heard = ''
    this.screen = 'listening'
  }

  /** Ends a hold. `text` is what was heard: speech, typed text or a replay line. */
  holdEnd(text: string, extra?: Extra | null) {
    this.listening = false
    this.heard = ''
    this.screen = this.before
    if (text.trim()) this.submit(text, extra)
    else this.flash = 'heard nothing'
  }

  menu(id: number) {
    switch (id) {
      case 1:
        if (this.result?.hits.length) this.screen = 'detail'
        break
      case 2:
        this.undo()
        break
      case 3:
        this.compare(this.highlight, this.highlight + 1 < (this.result?.hits.length ?? 0) ? this.highlight + 1 : 0)
        break
      case 4:
        this.history.push(this.query)
        this.query = { filters: [] }
        this.result = null
        this.screen = 'ready'
        break
      case 5:
        this.screen = 'recap'
        break
    }
  }

  undo() {
    const prev = this.history.pop()
    if (!prev) {
      this.flash = 'nothing to undo'
      return
    }
    this.query = prev
    this.refresh()
    this.screen = this.result ? 'results' : 'ready'
    this.flash = 'undid last change'
  }

  private compare(a: number, b: number) {
    const n = this.result?.hits.length ?? 0
    if (n < 2 || a >= n || b >= n || a === b) {
      this.flash = 'compare needs two rows'
      this.screen = this.result ? 'results' : 'ready'
      return
    }
    this.compared = [a, b]
    this.screen = 'compare'
  }

  reset() {
    this.query = { filters: [] }
    this.result = null
    this.highlight = 0
    this.shortlist.clear()
    this.history = []
    this.requests = 0
    this.transcript = []
    this.exportNote = 'export not set up'
    this.screen = 'ready'
  }
}
