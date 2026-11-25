// Companion page in the phone WebView. It mirrors the lens text, takes typed
// requests (a stand-in for speech) and logs every input event.

type Status = 'connecting' | 'live' | 'mirror' | 'error'

export interface UiHandlers {
  onSubmit(text: string): void
  onSheet(id: string): void
  onKey(kind: 'tap' | 'next' | 'prev' | 'hold' | 'release' | 'menu', id?: number): void
}

let statusEl: HTMLDivElement
let lensEl: HTMLPreElement
let logEl: HTMLOListElement
let inputEl: HTMLInputElement
let micEl: HTMLSpanElement

export function mountUi(sheets: { id: string; name: string }[], h: UiHandlers) {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>Onhand</h1>
        <div id="status" class="status status-connecting">Connecting</div>
      </header>
      <label class="row">Sheet
        <select id="sheet">${sheets.map(s => `<option value="${s.id}">${s.name} (synthetic)</option>`).join('')}</select>
      </label>
      <form id="ask" class="row">
        <input id="req" autocomplete="off" placeholder="Type what the client said, then Enter" />
      </form>
      <p class="hint">Hold the ring (or Space here) with text in the box to send it as if spoken.</p>
      <section aria-label="Lens mirror">
        <div class="lens-label">Lens (mirror of the glasses text) <span id="mic"></span></div>
        <pre id="lens" class="lens"></pre>
      </section>
      <div class="keys">
        <button data-k="hold">Hold</button><button data-k="tap">Tap</button>
        <button data-k="prev">Swipe up</button><button data-k="next">Swipe down</button>
        <button data-m="1">Details</button><button data-m="2">Undo</button><button data-m="3">Compare</button>
        <button data-m="4">Clear</button><button data-m="5">End</button>
      </div>
      <section aria-label="Input events">
        <div class="lens-label">Input events</div>
        <ol id="log" class="log"></ol>
      </section>
    </main>
  `
  statusEl = app.querySelector('#status')!
  lensEl = app.querySelector('#lens')!
  logEl = app.querySelector('#log')!
  inputEl = app.querySelector('#req')!
  micEl = app.querySelector('#mic')!

  app.querySelector<HTMLSelectElement>('#sheet')!.addEventListener('change', e => h.onSheet((e.target as HTMLSelectElement).value))
  app.querySelector<HTMLFormElement>('#ask')!.addEventListener('submit', e => {
    e.preventDefault()
    h.onSubmit(inputEl.value)
    inputEl.value = ''
  })
  app.querySelectorAll<HTMLButtonElement>('.keys button').forEach(b => {
    const k = b.dataset.k as 'tap' | 'next' | 'prev' | 'hold' | undefined
    const m = b.dataset.m
    if (k === 'hold') {
      b.addEventListener('pointerdown', () => h.onKey('hold'))
      b.addEventListener('pointerup', () => h.onKey('release'))
    } else if (k) b.addEventListener('click', () => h.onKey(k))
    else if (m) b.addEventListener('click', () => h.onKey('menu', Number(m)))
  })

  // Keyboard stand-ins for the ring when focus is not in the text box.
  let spaceDown = false
  window.addEventListener('keydown', e => {
    if (document.activeElement === inputEl && e.key !== 'Escape') return
    if (e.key === ' ' && !spaceDown) {
      spaceDown = true
      h.onKey('hold')
    } else if (e.key === 'ArrowDown') h.onKey('next')
    else if (e.key === 'ArrowUp') h.onKey('prev')
    else if (e.key === 'Enter') h.onKey('tap')
    else if (/^[1-5]$/.test(e.key)) h.onKey('menu', Number(e.key))
    else if (e.key === 'Escape') inputEl.blur()
    else return
    e.preventDefault()
  })
  window.addEventListener('keyup', e => {
    if (e.key === ' ' && spaceDown) {
      spaceDown = false
      h.onKey('release')
    }
  })
  injectStyles()
}

export function addSheetOption(id: string, name: string, select: boolean) {
  const el = document.querySelector<HTMLSelectElement>('#sheet')!
  if (!el.querySelector(`option[value="${id}"]`)) el.insertAdjacentHTML('afterbegin', `<option value="${id}">${name.replace(/</g, '&lt;')}</option>`)
  if (select) el.value = id
}

export function pendingText(): string {
  const t = inputEl?.value ?? ''
  if (inputEl) inputEl.value = ''
  return t
}

export function setStatus(kind: Status, text: string) {
  statusEl.className = `status status-${kind}`
  statusEl.textContent = text
}

export function setLens(text: string) {
  lensEl.textContent = text
}

export function setMic(text: string) {
  micEl.textContent = text
}

export function logEvent(text: string) {
  const li = document.createElement('li')
  li.textContent = `${new Date().toLocaleTimeString()}  ${text}`
  logEl.prepend(li)
  while (logEl.children.length > 14) logEl.lastChild?.remove()
}

function injectStyles() {
  const css = `
    :root { color-scheme: dark; }
    html, body { margin: 0; min-height: 100%; background: #232323; color: #E5E5E5;
      font: 15px/1.4 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif; }
    .panel { display: flex; flex-direction: column; gap: 12px; max-width: 640px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
    header { display: flex; align-items: center; justify-content: space-between; }
    h1 { font-size: 18px; font-weight: 600; margin: 0; }
    .status { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid #3E3E3E; text-transform: uppercase; letter-spacing: .04em; }
    .status-live { color: #3CFA44; border-color: #3CFA44; }
    .status-mirror { color: #E5E5E5; border-color: #7B7B7B; }
    .status-error { color: #FF453A; border-color: #FF453A; }
    .row { display: flex; gap: 8px; align-items: center; }
    select, input { flex: 1; background: #2E2E2E; color: #E5E5E5; border: 1px solid #3E3E3E; border-radius: 8px; padding: 10px; font: inherit; }
    input:focus, select:focus, button:focus-visible { outline: 2px solid #3CFA44; outline-offset: 1px; }
    .hint { margin: 0; font-size: 12px; color: #A7A7A7; }
    .lens-label { font-size: 12px; color: #A7A7A7; margin-bottom: 4px; }
    .lens { margin: 0; width: 100%; max-width: 576px; aspect-ratio: 2 / 1; box-sizing: border-box; padding: 8px 10px;
      background: #000; color: #3CFA44; border-radius: 6px; font: 15px/1.55 system-ui, sans-serif; white-space: pre; overflow: hidden; }
    .keys { display: flex; flex-wrap: wrap; gap: 6px; }
    button { background: #2E2E2E; color: #E5E5E5; border: 1px solid #3E3E3E; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; cursor: pointer; }
    button:active { background: #3E3E3E; }
    .log { margin: 0; padding-left: 18px; font: 12px/1.5 ui-monospace, Consolas, monospace; color: #A7A7A7; }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
