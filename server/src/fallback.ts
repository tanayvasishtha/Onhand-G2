// Claude fallback for the words the deterministic parser could not use.
// Claude only maps speech to filters on known columns and values; the engine
// still does all the row matching in plain code. Every filter it returns is
// checked against the sheet before use, so a made-up column or value is dropped.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import type { Filter, FilterPatch, Sheet } from '@onhand/shared'

const MODEL = process.env.ONHAND_MODEL ?? 'claude-opus-5-5'
const TIMEOUT_MS = Number(process.env.ONHAND_FALLBACK_TIMEOUT_MS ?? 6000)

const FilterOut = z.object({
  key: z.string(),
  op: z.enum(['range', 'in', 'not_in', 'is', 'lacks', 'has', 'text']),
  min: z.number().nullable(),
  max: z.number().nullable(),
  values: z.array(z.string()).nullable(),
  value: z.boolean().nullable(),
  q: z.string().nullable(),
})

const Reply = z.object({
  set: z.array(FilterOut),
  remove: z.array(z.string()),
  /** A short lens note for a requirement the sheet cannot answer ("no JBR in this sheet"). */
  note: z.string().nullable(),
})

export interface FallbackResult {
  set: Filter[]
  remove: string[]
  note?: string
  dropped: string[]
  ms: number
}

let client: Anthropic | null = null
export const fallbackEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY)

/** Describes the sheet's columns and allowed values for the prompt. Stable per sheet, so it caches. */
function describeSheet(sheet: Sheet): string {
  const lines = sheet.schema.columns.map(c => {
    let allowed = ''
    if (c.type === 'category' || c.type === 'list') {
      const vals = new Set<string>(Object.keys(c.values ?? {}))
      for (const r of sheet.rows) {
        const v = r.values[c.key]
        if (typeof v === 'string') vals.add(v)
        if (Array.isArray(v)) v.forEach(x => vals.add(String(x)))
      }
      allowed = ` values: ${[...vals].slice(0, 60).join(', ')}`
    }
    return `- ${c.key} (${c.type}, header "${c.header}")${allowed}`
  })
  return `Sheet "${sheet.schema.name}". Columns:\n${lines.join('\n')}`
}

const RULES = `You turn one spoken request from a client meeting into filters on a spreadsheet.
A deterministic parser has already handled most of the request. You get the full request, what the parser understood, and the words it could not use. Return filters only for those leftover words. Never repeat or change what the parser already set.
Rules:
- Use only column keys and values listed for the sheet. Values must be copied exactly as listed.
- range: numbers in the column's own units (money in full currency units, e.g. 2500000). Use null for an open end.
- Never set date columns (like handover); the parser owns those.
- in / not_in: category values. has / lacks: list values. is: yes/no columns. text: a word to match in a text column.
- If a leftover word asks for something the sheet has no column or value for, set no filter and put a short note under 40 characters, like "no JBR in this sheet" or "no villa column".
- If the leftover words are filler or not a requirement, return empty arrays and a null note.`

export async function fallback(text: string, sheet: Sheet, patch: FilterPatch): Promise<FallbackResult | null> {
  if (!fallbackEnabled() || !patch.unparsed.trim()) return null
  client ??= new Anthropic()
  const started = Date.now()
  const understood = JSON.stringify({ set: patch.set, remove: patch.remove, sort: patch.sort ?? null })
  const response = await client.messages.parse(
    {
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low', format: zodOutputFormat(Reply) },
      system: [{ type: 'text', text: `${RULES}\n\n${describeSheet(sheet)}`, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Request: ${JSON.stringify(text)}\nParser understood: ${understood}\nLeftover words: ${JSON.stringify(patch.unparsed)}`,
        },
      ],
    },
    { timeout: TIMEOUT_MS, maxRetries: 0 },
  )
  if (response.stop_reason === 'refusal' || !response.parsed_output) return { set: [], remove: [], dropped: ['no answer'], ms: Date.now() - started }
  const out = response.parsed_output
  const { set, dropped } = validate(out.set, sheet)
  const keys = new Set(sheet.schema.columns.map(c => c.key))
  return {
    set,
    remove: out.remove.filter(k => keys.has(k)),
    note: out.note ?? undefined,
    dropped,
    ms: Date.now() - started,
  }
}

/** Keeps only filters whose column exists, whose op fits the column type and whose values exist in the sheet. */
export function validate(raw: z.infer<typeof FilterOut>[], sheet: Sheet): { set: Filter[]; dropped: string[] } {
  const set: Filter[] = []
  const dropped: string[] = []
  for (const f of raw) {
    const col = sheet.schema.columns.find(c => c.key === f.key)
    if (!col) {
      dropped.push(`${f.key}: no such column`)
      continue
    }
    const numeric = ['int', 'number', 'money'].includes(col.type)
    if (f.op === 'range' && numeric && (f.min != null || f.max != null)) {
      set.push({ key: col.key, op: 'range', ...(f.min != null ? { min: f.min } : {}), ...(f.max != null ? { max: f.max } : {}) })
    } else if (f.op === 'is' && col.type === 'bool' && f.value != null) {
      set.push({ key: col.key, op: 'is', value: f.value })
    } else if (f.op === 'text' && col.type === 'text' && f.q?.trim()) {
      set.push({ key: col.key, op: 'text', q: f.q.trim().toLowerCase() })
    } else if ((f.op === 'in' || f.op === 'not_in') && col.type === 'category' && f.values?.length) {
      const known = canon(col.key, sheet)
      const values = f.values.map(v => known.get(v.toLowerCase())).filter((v): v is string => !!v)
      if (values.length) set.push({ key: col.key, op: f.op, values })
      else dropped.push(`${col.key}: unknown value ${f.values.join(', ')}`)
    } else if ((f.op === 'has' || f.op === 'lacks') && col.type === 'list' && f.values?.length) {
      const known = canon(col.key, sheet)
      const values = f.values.map(v => known.get(v.toLowerCase())).filter((v): v is string => !!v)
      if (values.length) set.push({ key: col.key, op: f.op, values })
      else dropped.push(`${col.key}: unknown value ${f.values.join(', ')}`)
    } else dropped.push(`${f.key}: ${f.op} does not fit a ${col.type} column`)
  }
  return { set, dropped }
}

function canon(key: string, sheet: Sheet): Map<string, string> {
  const col = sheet.schema.columns.find(c => c.key === key)!
  const m = new Map<string, string>()
  for (const v of Object.keys(col.values ?? {})) m.set(v.toLowerCase(), v)
  for (const r of sheet.rows) {
    const v = r.values[key]
    if (typeof v === 'string') m.set(v.toLowerCase(), v)
    if (Array.isArray(v)) v.forEach(x => m.set(String(x).toLowerCase(), String(x)))
  }
  return m
}
