import type { Filter, FilterPatch } from '../src/types'

/** One line per change, sorted, so expected and actual compare as sets. */
export function describePatch(p: FilterPatch): string[] {
  const out = p.set.map(fmt)
  for (const k of p.remove) out.push(`drop ${k}`)
  if (p.clear) out.push('clear')
  if (p.sort) out.push(`sort ${p.sort.key} ${p.sort.dir}`)
  if (p.command) {
    const c = p.command
    out.push(c.kind === 'compare' ? `compare ${c.a + 1} ${c.b + 1}` : c.kind === 'detail' ? `detail ${c.index + 1}` : c.kind)
  }
  return out.sort()
}

function fmt(f: Filter): string {
  switch (f.op) {
    case 'range':
      return `${f.key} ${f.min ?? ''}..${f.max ?? ''}`
    case 'is':
      return `${f.key} ${f.value ? 'yes' : 'no'}`
    case 'text':
      return `${f.key} ~${f.q}`
    default:
      return `${f.key} ${f.op === 'in' ? '' : f.op + ' '}${[...f.values].sort().join(',')}`
  }
}
