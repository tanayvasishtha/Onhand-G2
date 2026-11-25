export type ColType = 'money' | 'int' | 'number' | 'category' | 'bool' | 'date' | 'list' | 'text'

export interface Column {
  key: string
  /** Header text as it appears in the sheet. Matching is case-insensitive. */
  header: string
  type: ColType
  /** Other header spellings that map to this column. */
  headerAliases?: string[]
  /** Spoken words that name this column ("budget", "price"). */
  synonyms?: string[]
  /** For category and list columns: canonical value -> spoken or written aliases. */
  values?: Record<string, string[]>
  /** For category columns: canonical value -> nearby values tried when nothing matches. */
  neighbours?: Record<string, string[]>
  /** Unit words that follow a spoken number for this column ("km", "sqft"). */
  unitWords?: string[]
  /** Short label used on the lens filter line ("pets", "sea"). */
  label?: string
}

export interface CardField {
  key: string
  /** Text placed before the value, such as "#". */
  prefix?: string
  maxChars?: number
}

export interface Schema {
  id: string
  name: string
  /** One line about where the data comes from. Every bundled dataset is synthetic. */
  source: string
  columns: Column[]
  /** Column used as the row's name on cards. */
  titleKey: string
  /** Columns that must parse, or the row is skipped and reported. */
  requiredKeys: string[]
  /** Rows with the same values in these columns are duplicates; the later row wins. */
  dedupeKeys?: string[]
  /** Fields shown on one lens line per row, after the title. */
  card: CardField[]
  /** Fields shown on the detail screen. */
  detail: string[]
  defaultSort: SortSpec
  /** Order in which filters are relaxed when nothing matches. */
  relaxOrder: string[]
  /** Column the spoken budget words refer to. */
  priceKey?: string
  /** Column for "biggest" and "smallest". */
  sizeKey?: string
}

export type Cell = number | string | boolean | string[] | null

export interface Row {
  /** Sheet row number, header is row 1. */
  r: number
  values: Record<string, Cell>
  raw: Record<string, string>
}

export interface Skipped {
  r: number
  reason: string
}

export interface Sheet {
  schema: Schema
  rows: Row[]
  skipped: Skipped[]
  duplicates: number
}

export type Filter =
  | { key: string; op: 'range'; min?: number; max?: number }
  | { key: string; op: 'in'; values: string[] }
  | { key: string; op: 'not_in'; values: string[] }
  | { key: string; op: 'is'; value: boolean }
  /** List column must contain none of the values ("nut free"). */
  | { key: string; op: 'lacks'; values: string[] }
  /** List column must contain all of the values. */
  | { key: string; op: 'has'; values: string[] }
  /** Case-insensitive word match on a text column. */
  | { key: string; op: 'text'; q: string }

export interface SortSpec {
  key: string
  dir: 'asc' | 'desc'
}

export interface Query {
  filters: Filter[]
  sort?: SortSpec
}

export type Verdict = 'yes' | 'no' | 'unknown'

export interface Hit {
  row: Row
  /** Keys whose cell was blank, so the row only might match. Shown with "?". */
  unsure: string[]
}

export interface Relaxation {
  /** Keys of the filters that were relaxed, in ladder order. */
  keys: string[]
  /** What found nothing, for the lens: "no 3BR | Marina | <=2M". */
  note: string
  /** What was loosened, for the lens: "eased: pets, Sea, budget". */
  eased: string
  /** The filters actually used for the returned rows. */
  filters: Filter[]
}

export interface Result {
  hits: Hit[]
  /** Rows that satisfy every filter for sure. */
  total: number
  /** Rows that might match because a cell is blank. */
  maybe: number
  relaxed?: Relaxation
}

export type Command =
  | { kind: 'compare'; a: number; b: number }
  | { kind: 'count' }
  | { kind: 'detail'; index: number }
  | { kind: 'clear' }

export interface FilterPatch {
  /** Filters that replace any existing filter on the same key. */
  set: Filter[]
  /** Keys whose filters are removed. */
  remove: string[]
  clear?: boolean
  sort?: SortSpec
  command?: Command
  /** Words the parser could not use. Non-empty means the Claude fallback may help. */
  unparsed: string
}
