import type { Cell, Column, Row, Schema, Sheet, Skipped } from './types'
import {
  aliasIndex,
  normText,
  parseBool,
  parseCategory,
  parseCount,
  parseList,
  parseMoney,
  parseMonth,
  parseNumber,
} from './normalize'

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(r => r.some(f => f.trim() !== ''))
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map(r =>
      r
        .map(v => {
          const s = String(v)
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\n') + '\n'
}

export function parseCell(raw: string, col: Column, idx: Map<string, string>): Cell {
  switch (col.type) {
    case 'money':
      return parseMoney(raw)
    case 'int':
      return parseCount(raw)
    case 'number':
      return parseNumber(raw)
    case 'bool':
      return parseBool(raw)
    case 'date':
      return parseMonth(raw)
    case 'category':
      return parseCategory(raw, idx)
    case 'list':
      return parseList(raw, idx)
    case 'text':
      return raw.trim() || null
  }
}

/** Reads a CSV (or a Sheets values.get grid) into typed rows using a fixed schema. */
export function loadSheet(grid: string[][], schema: Schema): Sheet {
  const [header, ...body] = grid
  const colIndex = new Map<string, number>()
  const normHeader = header.map(h => normText(h))
  for (const col of schema.columns) {
    const names = [col.header, ...(col.headerAliases ?? [])].map(normText)
    const i = normHeader.findIndex(h => names.includes(h))
    if (i >= 0) colIndex.set(col.key, i)
  }
  const missing = schema.requiredKeys.filter(k => !colIndex.has(k))
  if (missing.length) throw new Error(`Sheet is missing required columns: ${missing.join(', ')}`)

  const indexes = new Map(schema.columns.map(c => [c.key, aliasIndex(c.values)]))
  const rows: Row[] = []
  const skipped: Skipped[] = []
  body.forEach((cells, i) => {
    const r = i + 2
    const values: Record<string, Cell> = {}
    const raw: Record<string, string> = {}
    for (const col of schema.columns) {
      const ci = colIndex.get(col.key)
      const text = ci == null ? '' : (cells[ci] ?? '')
      raw[col.key] = text.trim()
      values[col.key] = parseCell(text, col, indexes.get(col.key)!)
    }
    const bad = schema.requiredKeys.find(k => values[k] == null)
    if (bad) {
      skipped.push({ r, reason: `${bad} unreadable: "${raw[bad]}"` })
      return
    }
    rows.push({ r, values, raw })
  })

  let duplicates = 0
  let kept = rows
  if (schema.dedupeKeys?.length) {
    const last = new Map<string, Row>()
    for (const row of rows) {
      const key = schema.dedupeKeys.map(k => normText(String(row.values[k] ?? ''))).join('|')
      if (last.has(key)) duplicates++
      last.set(key, row)
    }
    const keep = new Set(last.values())
    kept = rows.filter(r => keep.has(r))
  }
  return { schema, rows: kept, skipped, duplicates }
}

export function loadCsv(text: string, schema: Schema): Sheet {
  return loadSheet(parseCsv(text), schema)
}

export function column(schema: Schema, key: string): Column {
  const c = schema.columns.find(col => col.key === key)
  if (!c) throw new Error(`Unknown column ${key} in ${schema.id}`)
  return c
}
