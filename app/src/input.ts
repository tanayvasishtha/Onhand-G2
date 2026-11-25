import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'

export type Gesture =
  | { kind: 'tap' | 'next' | 'prev' | 'hold' | 'release' | 'exit' | 'system-exit'; source: number }
  | { kind: 'menu'; id: number; source: number }

/**
 * Maps one SDK event to one gesture. A single tap arrives with no eventType
 * (CLICK_EVENT is 0 and protobuf drops zero fields), so `undefined` counts as
 * a tap, but only inside a text or sys envelope, never on audio frames.
 */
export function toGesture(e: EvenHubEvent): Gesture | null {
  const menuId = e.menuItemClickEvent?.itemID
  if (menuId) return { kind: 'menu', id: menuId, source: 0 }
  const env = e.sysEvent ?? e.textEvent ?? e.listEvent
  if (!env) return null
  const source = e.sysEvent?.eventSource ?? 0
  const type = env.eventType ?? OsEventTypeList.CLICK_EVENT
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: 'tap', source }
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: 'exit', source }
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { kind: 'next', source }
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { kind: 'prev', source }
    case OsEventTypeList.LONG_PRESS_EVENT:
      return { kind: 'hold', source }
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return { kind: 'release', source }
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return { kind: 'system-exit', source }
    default:
      // FOREGROUND_ENTER/EXIT fire when the contextual menu opens and closes.
      return null
  }
}

/**
 * Drops repeats and accidental holds:
 * - the same gesture from the same source within 150 ms is a duplicate;
 * - a hold that starts within 600 ms of a tap is the OS "tap then hold" menu
 *   gesture, so it and its release are ignored.
 */
export class GestureFilter {
  private last = new Map<string, number>()
  private lastTap = -Infinity
  private swallowRelease = false

  constructor(private now: () => number = () => performance.now()) {}

  accept(g: Gesture): boolean {
    const t = this.now()
    const key = `${g.kind}:${g.source}`
    const prev = this.last.get(key)
    this.last.set(key, t)
    if (prev != null && t - prev < 150) return false
    if (g.kind === 'tap') this.lastTap = t
    if (g.kind === 'hold' && t - this.lastTap < 600) {
      this.swallowRelease = true
      return false
    }
    if (g.kind === 'release' && this.swallowRelease) {
      this.swallowRelease = false
      return false
    }
    return true
  }
}
