// Toolbar injected into Chrome's ISOLATED world via chrome.scripting.executeScript({ func }).
//
// CRITICAL: entirely self-contained. The function is serialized via
// Function.prototype.toString(), so no external imports, no module-level refs,
// all helpers as inner functions, all constants defined inline. TS type
// annotations are stripped at compile time — safe to use.
//
// Privileged actions call chrome.runtime directly. Never bridge through page events.

declare global {
  interface Window {
    __playwriterToolbarInstalled?: boolean
    __playwriterToolbarDestroy?: () => void
    __playwriterToolbarSetRecording?: (recording: boolean) => void
    __playwriterToolbarStopRecording?: (() => void) | null
    __playwriterToolbarStartRecording?: (() => void) | null
    __playwriterToolbarSetRemote?: (active: boolean) => void
    __playwriterToolbarStartRemote?: (() => void) | null
    __playwriterToolbarStopRemote?: (() => void) | null
    __playwriterToolbarShowToast?: (msg: string) => void
    __playwriterToolbarPlaySound?: (name: string) => void
    __playwriterPinCount?: number
    // Template literal index for pinned element globals (playwriterPinnedElem1, etc.)
    [key: `playwriterPinnedElem${number}`]: Element | undefined
  }
}

export function initPlaywriterToolbar(): void {
  if (window.__playwriterToolbarInstalled) return
  window.__playwriterToolbarInstalled = true

  // Top-level frame only — skip iframes (cross-origin access throws).
  try {
    if (window !== window.top) return
  } catch {
    return
  }

  let pinModeActive = false
  let toastTimer: number | null = null
  let overlayEl: HTMLDivElement | null = null
  let pinMoveRaf = 0
  let pinMoveEvent: MouseEvent | null = null
  let isRecording = false
  let startInFlight = false
  let pendingStop = false
  let isDragging = false
  // Declared here so the hoisted setPinMode can reference it before assignment.
  let pinBtn!: HTMLButtonElement
  // Shift-click multi-select: accumulated pins while pin mode stays active.
  // Each entry tracks the pin number and element so we can build a combined
  // clipboard string and clear persistent outlines when pin mode exits.
  let accumulatedPins: { n: number; element: Element; prevOutline: string; prevOffset: string }[] =
    []

  // ── Position persistence via localStorage (percentages of viewport) ────────

  const POS_KEY = '__playwriter_toolbar_pos'

  function loadPosition(): { leftPct: number; topPct: number } | null {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed.leftPct === 'number' && typeof parsed.topPct === 'number') {
        return parsed
      }
    } catch {}
    return null
  }

  function savePosition(leftPct: number, topPct: number): void {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ leftPct, topPct }))
    } catch {}
  }

  // ── Create shadow-DOM host ─────────────────────────────────────────────────

  const host = document.createElement('div')
  host.setAttribute('data-playwriter-toolbar', '1')

  const savedPos = loadPosition()
  const initLeft = savedPos ? `${savedPos.leftPct}%` : '50%'
  const initTop = savedPos ? `${savedPos.topPct}%` : '12px'
  let intendedLeft = initLeft
  let intendedTop = initTop

  // pointer-events:none on the host so the shadow-DOM children (pointer-events:all)
  // control interactivity without the host element itself blocking page events.
  // No contain:paint — it clips box-shadow to the host's rectangular bounds.
  host.style.cssText =
    `all:initial;position:fixed;top:${initTop};left:${initLeft};transform:translateX(-50%);z-index:2147483647;pointer-events:none;opacity:1;visibility:visible;display:block;filter:none;font-size:0;line-height:0;contain:layout style;`

  // Closed shadow root: page scripts cannot access our toolbar DOM
  const shadow = host.attachShadow({ mode: 'closed' })

  const styleEl = document.createElement('style')
  // Dark egaki-inspired toolbar: #1c1c1c bg, white/10 border, pill shape
  styleEl.textContent = `
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
    .stack {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 3px 7px;
      background: #1c1c1c;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 9999px;
      pointer-events: all;
      user-select: none;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      contain: layout style;
      opacity: 1;
      transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1);
      @starting-style {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toolbar {
        transition: none;
      }
    }
    .separator {
      width: 1px;
      height: 15px;
      background: rgba(255,255,255,0.15);
      margin: 0 2px;
      flex-shrink: 0;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: rgba(161,161,170,1);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      padding: 0;
      flex-shrink: 0;
      outline: none;
    }
    .btn.labeled {
      width: auto;
      gap: 6px;
      padding: 0 7px;
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      white-space: nowrap;
    }
    .btn:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(228,228,231,1);
    }
    .btn.active {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }
    .btn.active:hover {
      background: rgba(255,255,255,0.18);
    }
    .drag-handle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 19px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: rgba(161,161,170,0.5);
      cursor: grab;
      transition: background 0.15s, color 0.15s;
      padding: 0;
      flex-shrink: 0;
      outline: none;
    }
    .drag-handle:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(161,161,170,0.8);
    }
    .drag-handle:active, .drag-handle.dragging {
      cursor: grabbing;
      color: rgba(228,228,231,0.9);
    }
    .record-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: rgba(161,161,170,1);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      padding: 3px 8px;
      font-size: 12px;
      font-weight: 500;
      outline: none;
      white-space: nowrap;
      font-family: inherit;
    }
    .record-btn:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(228,228,231,1);
    }
    .record-btn.active {
      color: rgba(161,161,170,1);
    }
    .record-btn.active:hover {
      background: rgba(255,255,255,0.08);
      color: rgba(228,228,231,1);
    }
    .record-btn.loading {
      cursor: progress;
    }
    .remote-btn svg {
      color: #7dd3fc;
    }
    .remote-btn.remote-active {
      color: #7dd3fc;
      background: rgba(125,211,252,0.10);
    }
    .remote-btn.remote-active:hover {
      background: rgba(125,211,252,0.18);
      color: #bae6fd;
    }
    .remote-btn .chevron {
      width: 10px;
      height: 10px;
      opacity: 0.75;
      flex-shrink: 0;
    }
    .remote-btn.menu-open .chevron {
      transform: rotate(180deg);
    }
    .remote-panel {
      display: none;
      flex-direction: column;
      gap: 2px;
      margin-top: 6px;
      padding: 4px;
      background: #1c1c1c;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      pointer-events: all;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.15);
      min-width: 168px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .remote-panel.open {
      display: flex;
    }
    /* The Playwright fork sets data-playwriter-agent on the host before each
       hit-target check (injectedScript.ts), so agent clicks pass through. */
    :host([data-playwriter-agent]) .toolbar,
    :host([data-playwriter-agent]) .remote-panel {
      pointer-events: none;
    }
    .remote-panel button {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      border: none;
      background: transparent;
      color: rgba(228,228,231,1);
      text-align: left;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
    }
    .remote-panel button:hover {
      background: rgba(255,255,255,0.08);
    }
    .remote-panel button svg {
      flex-shrink: 0;
      color: rgba(161,161,170,1);
    }
    .remote-panel button.danger svg {
      color: #f87171;
    }
    .remote-panel p {
      color: rgba(212,212,216,1);
      font-size: 11px;
      line-height: 1.4;
      padding: 6px 8px 2px;
      max-width: 240px;
    }
    .remote-panel a {
      color: #7dd3fc;
      font-size: inherit;
      padding: 0;
      text-decoration: none;
    }
    .remote-panel a:hover {
      text-decoration: underline;
    }
    .remote-panel-actions {
      display: flex;
      gap: 4px;
      padding: 4px;
    }
    .remote-panel-actions button {
      flex: 1;
      width: auto;
      justify-content: center;
      text-align: center;
    }
    .remote-panel-actions button.primary {
      background: rgba(125,211,252,0.16);
      color: #7dd3fc;
    }
    .remote-panel-actions button.primary:hover {
      background: rgba(125,211,252,0.24);
    }
    .record-btn .spinner {
      display: block;
      width: 12px;
      height: 12px;
      animation: record-spin 0.7s linear infinite;
    }
    @keyframes record-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .record-btn .spinner {
        animation: none;
      }
    }
    [data-tooltip] {
      position: relative;
    }
    [data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      top: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 5px 10px;
      background: #1c1c1c;
      border: 1px solid rgba(255,255,255,0.1);
      color: rgba(228,228,231,1);
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      white-space: nowrap;
      border-radius: 6px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4);
    }
    [data-tooltip]:hover::after {
      opacity: 1;
      transition: opacity 0.15s ease 0.3s;
    }
    .tooltips-disabled [data-tooltip]:hover::after {
      opacity: 0;
      transition: none;
    }
  `

  const toolbarEl = document.createElement('div')
  toolbarEl.className = 'toolbar'
  toolbarEl.setAttribute('role', 'toolbar')
  toolbarEl.setAttribute('aria-label', 'Playwriter tools')

  const stack = document.createElement('div')
  stack.className = 'stack'

  shadow.appendChild(styleEl)
  shadow.appendChild(stack)
  stack.appendChild(toolbarEl)

  // Own overlay so position:fixed is viewport-relative. The toolbar host has
  // transform + contain, which would otherwise make the toast a child of the bar.
  const toastHost = document.createElement('div')
  toastHost.setAttribute('data-playwriter-toolbar', '1')
  toastHost.style.cssText =
    'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:1;visibility:visible;display:block;filter:none;'
  const toastShadow = toastHost.attachShadow({ mode: 'closed' })
  const toastStyle = document.createElement('style')
  toastStyle.textContent = `
    .toast {
      position: absolute;
      background: #1c1c1c;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 9999px;
      padding: 6px 14px;
      color: rgba(228,228,231,1);
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 12px 60px rgba(0,0,0,0.6), 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.15);
      white-space: nowrap;
      animation: toast-in 0.15s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `
  toastShadow.appendChild(toastStyle)

  function showToast(msg: string, anchor?: { rect: DOMRect; clientX: number }): void {
    toastShadow.querySelectorAll('.toast').forEach((el) => {
      el.remove()
    })
    if (toastTimer !== null) clearTimeout(toastTimer)
    const toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.textContent = msg

    const GAP = 10
    const bar = host.getBoundingClientRect()
    const x = anchor
      ? Math.max(8, Math.min(anchor.clientX, window.innerWidth - 8))
      : bar.left + bar.width / 2
    const belowY = anchor ? anchor.rect.bottom + GAP : bar.bottom + GAP
    const aboveY = anchor ? anchor.rect.top - GAP : bar.top - GAP
    const fitsBelow = belowY + 36 < window.innerHeight
    toastEl.style.left = x + 'px'
    toastEl.style.top = (fitsBelow ? belowY : aboveY) + 'px'
    toastEl.style.transform = fitsBelow ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)'

    toastShadow.appendChild(toastEl)
    toastTimer = window.setTimeout(() => {
      toastEl.remove()
    }, 1900)
  }

  // ── Helper: hover overlay (shown under cursor in pin mode) ─────────────────
  //
  // Matches mesurer's rendering exactly: four 1px-thin edge divs as the border,
  // plus a very subtle fill background. Colors from mesurer's measurement-box.tsx:
  //   outlineColor = color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)
  //   fillColor    = color-mix(in oklch, oklch(0.62 0.18 255) 8%,  transparent)
  // This is thinner and cleaner than a CSS outline/border.

  function getOverlay(): HTMLDivElement {
    if (!overlayEl) {
      const EDGE = 'color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)'
      const FILL = 'color-mix(in oklch, oklch(0.62 0.18 255) 8%, transparent)'

      const container = document.createElement('div')
      container.setAttribute('data-playwriter-overlay', '1')
      container.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:2147483646',
        `background:${FILL}`,
        'visibility:hidden',
        'contain:layout style paint',
      ].join(';')

      // Four 1px edge divs — same technique as mesurer measurement-box
      const edgeTop = document.createElement('div')
      edgeTop.style.cssText = `position:absolute;top:0;left:0;width:100%;height:1px;background:${EDGE};`

      const edgeRight = document.createElement('div')
      edgeRight.style.cssText = `position:absolute;top:0;right:0;width:1px;height:100%;background:${EDGE};`

      const edgeBottom = document.createElement('div')
      edgeBottom.style.cssText = `position:absolute;bottom:0;left:0;width:100%;height:1px;background:${EDGE};`

      const edgeLeft = document.createElement('div')
      edgeLeft.style.cssText = `position:absolute;top:0;left:0;width:1px;height:100%;background:${EDGE};`

      container.appendChild(edgeTop)
      container.appendChild(edgeRight)
      container.appendChild(edgeBottom)
      container.appendChild(edgeLeft)

      document.documentElement.appendChild(container)
      overlayEl = container
    }
    return overlayEl
  }

  function positionOverlay(target: Element): void {
    const rect = target.getBoundingClientRect()
    if (!rect.width && !rect.height) return
    const overlay = getOverlay()
    overlay.style.visibility = 'visible'
    overlay.style.top = rect.top + 'px'
    overlay.style.left = rect.left + 'px'
    overlay.style.width = rect.width + 'px'
    overlay.style.height = rect.height + 'px'
  }

  function hideOverlay(): void {
    if (overlayEl) overlayEl.style.visibility = 'hidden'
  }

  function cancelPinMove(): void {
    if (pinMoveRaf) {
      cancelAnimationFrame(pinMoveRaf)
      pinMoveRaf = 0
    }
    pinMoveEvent = null
  }

  function removeOverlay(): void {
    cancelPinMove()
    if (overlayEl) {
      overlayEl.remove()
      overlayEl = null
    }
  }

  // ── Helper: find element at point, skipping our own injected DOM ───────────

  function getTargetAt(x: number, y: number): Element | null {
    // Overlay is pointer-events:none so elementFromPoint skips it.
    // Over the toolbar this returns the host (closed shadow retarget).
    const el = document.elementFromPoint(x, y)
    if (!el || el === host || el === document.documentElement || el === document.body) {
      return null
    }
    if (el.hasAttribute('data-playwriter-overlay') || el.hasAttribute('data-playwriter-toolbar')) {
      return null
    }
    return el
  }

  // composedPath with a closed shadow root still includes the host element,
  // so this correctly detects clicks/moves that land on our toolbar
  function isOverToolbar(e: MouseEvent): boolean {
    return e.composedPath().some((node) => node === host)
  }

  // Guards the privileged buttons (Record Skill, Remote control) against UI redress.
  // The shadow root is closed, so a page cannot click the buttons directly, but the
  // host lives in the page's light DOM and page CSS can still restyle it. The host
  // therefore uses `all:initial` and these checks reject clicks when the bar is
  // hidden, filtered, covered, or moved away from where the user last put it.
  // ALWAYS toast on rejection: a silent guard once hid a real bug where
  // example.com's `div{opacity:.8}` disabled both buttons on every page.
  // Tolerance is relative because `html{zoom}` scales getBoundingClientRect.
  function isTrustedToolbarClick(e: MouseEvent): boolean {
    if (!e.isTrusted || !navigator.userActivation.isActive) {
      return false
    }
    const style = getComputedStyle(host)
    const restyled =
      style.display === 'none' ||
      style.visibility !== 'visible' ||
      Number(style.opacity) < 0.9 ||
      style.filter !== 'none' ||
      style.backdropFilter !== 'none'
    const resolvePosition = (value: string, viewportSize: number): number => {
      return value.endsWith('%') ? (parseFloat(value) / 100) * viewportSize : parseFloat(value)
    }
    const tolerance = (expected: number): number => {
      return Math.max(2, Math.abs(expected) * 0.25)
    }
    const rect = host.getBoundingClientRect()
    const expectedCenterX = resolvePosition(intendedLeft, window.innerWidth)
    const expectedTop = resolvePosition(intendedTop, window.innerHeight)
    const moved =
      Math.abs(rect.left + rect.width / 2 - expectedCenterX) >= tolerance(expectedCenterX) ||
      Math.abs(rect.top - expectedTop) >= tolerance(expectedTop)
    if (restyled || moved || document.elementFromPoint(e.clientX, e.clientY) !== host) {
      showToast('Blocked: this page is restyling the Playwriter toolbar')
      return false
    }
    return true
  }

  // ── Helper: flash green outline on a pinned element ────────────────────────

  function flashElement(el: Element, persistent = false): { prevOutline: string; prevOffset: string } {
    const s = (el as HTMLElement).style
    const prevOutline = s?.outline || ''
    const prevOffset = s?.outlineOffset || ''
    if (!s) return { prevOutline, prevOffset }
    s.outline = '1px solid #22c55e'
    s.outlineOffset = '2px'
    if (!persistent) {
      window.setTimeout(() => {
        s.outline = prevOutline
        s.outlineOffset = prevOffset
      }, 350)
    }
    return { prevOutline, prevOffset }
  }

  function clearAccumulatedOutlines(): void {
    for (const pin of accumulatedPins) {
      const s = (pin.element as HTMLElement).style
      if (!s) continue
      s.outline = pin.prevOutline
      s.outlineOffset = pin.prevOffset
    }
    accumulatedPins = []
  }

  // ── Helper: copy text through the extension-owned offscreen document ───────

  function copyText(text: string): void {
    void chrome.runtime.sendMessage({ action: 'copyToolbarText', text })
  }

  // ── Pin mode: expose a selected element to Playwright's MAIN world ─────────

  async function pinTarget(target: Element): Promise<number | null> {
    const markerBytes = new Uint8Array(16)
    crypto.getRandomValues(markerBytes)
    const marker = Array.from(markerBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    target.setAttribute('data-playwriter-pin-target', marker)
    try {
      const result: { pinNumber?: number } | undefined = await chrome.runtime.sendMessage({
        action: 'pinToolbarElement',
        marker,
      })
      return result?.pinNumber || null
    } catch {
      return null
    } finally {
      if (target.getAttribute('data-playwriter-pin-target') === marker) {
        target.removeAttribute('data-playwriter-pin-target')
      }
    }
  }

  // ── Pin mode event handlers ────────────────────────────────────────────────

  function onMouseMove(e: MouseEvent): void {
    pinMoveEvent = e
    if (pinMoveRaf) return
    pinMoveRaf = requestAnimationFrame(() => {
      pinMoveRaf = 0
      const ev = pinMoveEvent
      if (!ev) return
      if (isOverToolbar(ev)) {
        hideOverlay()
        return
      }
      const target = getTargetAt(ev.clientX, ev.clientY)
      if (target) positionOverlay(target)
      else hideOverlay()
    })
  }

  // Build a tiny eval that delegates all logging and React inspection to Playwriter.
  // JSON.stringify does NOT escape literal ' characters, so "Don't save"
  // stays "Don't save" in the output. That would break the outer bash '…'
  // wrapper. Replace ' with \u0027 — valid JSON, parses back to ' in the
  // JS engine — so the whole code is single-quote-free and slots safely
  // into the bash 'playwriter -e …' wrapper regardless of element text.
  function buildInspectionCode(n: number, url: string): string {
    const URL_LIT = JSON.stringify(url).replace(/'/g, '\\u0027')
    return `inspectPinnedElement(${URL_LIT},"globalThis.playwriterPinnedElem${n}")`
  }

  async function onClick(e: MouseEvent): Promise<void> {
    if (!e.isTrusted) return
    if (isOverToolbar(e)) return
    e.preventDefault()
    e.stopImmediatePropagation()

    const target = getTargetAt(e.clientX, e.clientY)
    if (!target) return
    const n = await pinTarget(target)
    if (!pinModeActive) return
    if (!n) {
      showToast('Could not pin element')
      return
    }
    playSound('success')
    const url = location.href

    if (e.shiftKey) {
      // Shift-click: accumulate this element, keep pin mode active.
      // Skip duplicate elements so re-clicking the same element doesn't
      // save an already-green outline as the "original" style.
      const alreadyPinned = accumulatedPins.some((p) => p.element === target)
      if (!alreadyPinned) {
        const saved = flashElement(target, true)
        accumulatedPins.push({ n, element: target, ...saved })
      }
      const clipboardText = accumulatedPins
        .map((p) => {
          return "playwriter -e '" + buildInspectionCode(p.n, url) + "'"
        })
        .join(',\n')
      copyText(clipboardText)
      showToast(`Copied ${accumulatedPins.length} locators`, {
        rect: target.getBoundingClientRect(),
        clientX: e.clientX,
      })
    } else {
      // Normal click: include any accumulated pins, then exit pin mode.
      // Clear persistent outlines before the temporary flash so the
      // flash doesn't save green as the "previous" outline to restore.
      const rect = target.getBoundingClientRect()
      const alreadyPinned = accumulatedPins.some((p) => p.element === target)
      const allPins = alreadyPinned
        ? accumulatedPins
        : [...accumulatedPins, { n, element: target, prevOutline: '', prevOffset: '' }]
      clearAccumulatedOutlines()
      flashElement(target)
      if (allPins.length > 1) {
        const clipboardText = allPins
          .map((p) => {
            return "playwriter -e '" + buildInspectionCode(p.n, url) + "'"
          })
          .join(',\n')
        copyText(clipboardText)
        showToast(`Copied ${allPins.length} locators`, { rect, clientX: e.clientX })
      } else {
        const code = buildInspectionCode(n, url)
        const clipboardText = "playwriter -e '" + code + "'"
        copyText(clipboardText)
        showToast('Copied locator', { rect, clientX: e.clientX })
      }
      setPinMode(false)
    }
  }

  // Prevent shift+click text selection and other default mousedown behavior
  // while in pin mode. The click handler's preventDefault is too late because
  // the browser starts selection on mousedown, not click.
  function onMouseDown(e: MouseEvent): void {
    if (isOverToolbar(e)) return
    e.preventDefault()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') setPinMode(false)
  }

  // ── Pin mode toggle ────────────────────────────────────────────────────────

  function setPinMode(on: boolean): void {
    pinModeActive = on
    // pinBtn is declared above and assigned below; safe to reference here
    // because setPinMode is only called from event listeners that fire after
    // all setup code has run
    pinBtn.classList.toggle('active', on)

    if (on) {
      accumulatedPins = []
      document.documentElement.style.cursor = 'crosshair'
      getOverlay() // ensure overlay element exists in DOM
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })
      document.addEventListener('click', onClick, true)
      document.addEventListener('keydown', onKeyDown, true)
    } else {
      cancelPinMove()
      clearAccumulatedOutlines()
      document.documentElement.style.cursor = ''
      hideOverlay()
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }

  // ── SVG icon strings (defined inside function — required for func injection) ─

  // Playwriter logo with cutout cursor (fill-rule evenodd punches a hole through the icon)
  const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 424 424" aria-hidden="true"><path fill-rule="evenodd" d="M 0 212 C 0 112.063 0 62.095 31.037 31.037 C 62.116 0 112.063 0 212 0 C 311.937 0 361.905 0 392.942 31.037 C 424 62.116 424 112.063 424 212 C 424 311.937 424 361.905 392.942 392.942 C 361.926 424 311.937 424 212 424 C 112.063 424 62.095 424 31.037 392.942 C 0 361.926 0 311.937 0 212 Z M 225.732 260.521 L 277.905 312.673 C 283.311 318.1 286.003 320.793 289.014 322.043 C 293.042 323.718 297.557 323.718 301.585 322.043 C 304.596 320.793 307.309 318.1 312.694 312.694 C 318.1 307.288 320.793 304.596 322.043 301.585 C 323.722 297.563 323.722 293.036 322.043 289.014 C 320.793 286.003 318.1 283.29 312.694 277.905 L 260.521 225.732 L 276.442 209.789 C 292.766 193.465 300.907 185.325 298.999 176.548 C 297.07 167.792 286.237 163.785 264.591 155.814 L 192.384 129.208 C 149.2 113.308 127.618 105.358 116.488 116.488 C 105.358 127.618 113.308 149.2 129.208 192.384 L 155.814 264.591 C 163.785 286.237 167.792 297.07 176.548 298.999 C 185.303 300.928 193.465 292.766 209.789 276.442 Z" fill="currentColor"/></svg>`

  // Lucide x icon
  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  // 6-dot grip for dragging (2 columns x 3 rows)
  const DRAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.3"/><circle cx="6" cy="2" r="1.3"/><circle cx="2" cy="7" r="1.3"/><circle cx="6" cy="7" r="1.3"/><circle cx="2" cy="12" r="1.3"/><circle cx="6" cy="12" r="1.3"/></svg>`

  // Record circle icon (red filled circle)
  const RECORD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="#ef4444"/></svg>`

  // Stop square icon (red filled square)
  const STOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="#ef4444"/></svg>`

  // Lucide cloud icon (light blue via .remote-btn svg color)
  const CLOUD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`

  const CHEVRON_SVG = `<svg class="chevron" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`

  // TODO: re-enable Copy remote URL when viewer playback is fast enough.
  // const LINK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`

  const CLIPBOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`

  const HASH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>`

  const CLOUD_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.01 7.01 0 0 0 10 5.07"/></svg>`

  const SPINNER_SVG = `<svg class="spinner" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.5" stroke-opacity="0.25"/><path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`

  // ── Sound synthesis (cuelume-inspired, Web Audio API) ───────────────────────
  // Recipes from https://github.com/Danilaa1/cuelume — synthesized live, no audio files.

  let audioCtx: AudioContext | null = null

  const SOUND_RECIPES: Record<string, { masterGain: number; layers: any[]; shimmer?: any }> = {
    // Three-note ascending confirmation (copy to clipboard)
    success: {
      masterGain: 0.5,
      layers: [
        { kind: 'tone', waveform: 'sine', frequency: 880, attack: 0.004, decay: 0.09, peak: 0.06 },
        { kind: 'tone', waveform: 'sine', frequency: 1108.73, offset: 0.06, attack: 0.004, decay: 0.1, peak: 0.06 },
        { kind: 'tone', waveform: 'sine', frequency: 1318.51, offset: 0.12, attack: 0.004, decay: 0.18, peak: 0.07 },
      ],
      shimmer: { delay: 0.1, feedback: 0.22, wet: 0.16, lowpass: 4500 },
    },
    // Short UI tick for toolbar buttons
    click: {
      masterGain: 0.38,
      layers: [
        { kind: 'tone', waveform: 'sine', frequency: 1400, attack: 0.002, decay: 0.04, peak: 0.05 },
        { kind: 'noise', filterType: 'highpass', filterFreq: 3000, filterQ: 0.5, attack: 0.001, decay: 0.025, peak: 0.018 },
      ],
    },
    // Lock-on sweep that resolves (recording started)
    record: {
      masterGain: 0.48,
      layers: [
        { kind: 'noise', filterType: 'bandpass', filterFreq: 3600, filterQ: 1.8, attack: 0.001, decay: 0.02, peak: 0.11 },
        { kind: 'tone', waveform: 'triangle', frequency: 330, glideTo: 660, glideTime: 0.12, offset: 0.012, attack: 0.004, decay: 0.16, peak: 0.055 },
        { kind: 'tone', waveform: 'sine', frequency: 990, offset: 0.13, attack: 0.004, decay: 0.22, peak: 0.06 },
      ],
      shimmer: { delay: 0.1, feedback: 0.16, wet: 0.1, lowpass: 4200 },
    },
  }

  function renderSoundRecipe(ctx: AudioContext, recipe: any): void {
    const now = ctx.currentTime
    const output = ctx.createGain()
    output.gain.value = 4
    output.connect(ctx.destination)
    const master = ctx.createGain()
    master.gain.value = recipe.masterGain
    master.connect(output)

    if (recipe.shimmer) {
      const s = recipe.shimmer
      const dl = ctx.createDelay(1)
      dl.delayTime.value = s.delay
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = s.lowpass
      const fb = ctx.createGain()
      fb.gain.value = s.feedback
      const wet = ctx.createGain()
      wet.gain.value = s.wet
      master.connect(dl)
      dl.connect(lp).connect(fb).connect(dl)
      lp.connect(wet).connect(output)
    }

    for (const l of recipe.layers) {
      const t = now + (l.offset || 0)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, t)
      env.gain.exponentialRampToValueAtTime(l.peak, t + l.attack)
      env.gain.exponentialRampToValueAtTime(0.0001, t + l.attack + l.decay)
      env.connect(master)

      if (l.kind === 'tone') {
        const osc = ctx.createOscillator()
        osc.type = l.waveform
        osc.frequency.setValueAtTime(l.frequency, t)
        if (l.glideTo) {
          osc.frequency.exponentialRampToValueAtTime(l.glideTo, t + (l.glideTime || l.attack + l.decay))
        }
        osc.connect(env)
        osc.start(t)
        osc.stop(t + l.attack + l.decay + 0.05)
      } else {
        const dur = l.attack + l.decay + 0.05
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(dur * ctx.sampleRate)), ctx.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < d.length; i++) d[i] = 2 * Math.random() - 1
        const src = ctx.createBufferSource()
        src.buffer = buf
        const flt = ctx.createBiquadFilter()
        flt.type = l.filterType
        flt.frequency.value = l.filterFreq
        if (l.filterQ) flt.Q.value = l.filterQ
        src.connect(flt).connect(env)
        src.start(t)
        src.stop(t + dur)
      }
    }
  }

  function playSound(name: string): void {
    try {
      const recipe = SOUND_RECIPES[name]
      if (!recipe) return
      if (!audioCtx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext
        if (!Ctor) return
        audioCtx = new Ctor()
      }
      const ctx = audioCtx
      if (ctx.state === 'running') {
        renderSoundRecipe(ctx, recipe)
      } else {
        void ctx.resume().then(() => {
          if (ctx.state === 'running') renderSoundRecipe(ctx, recipe)
        }).catch(() => {})
      }
    } catch {}
  }

  // ── Build toolbar buttons ──────────────────────────────────────────────────

  // Pin element button
  pinBtn = document.createElement('button')
  pinBtn.className = 'btn labeled'
  pinBtn.setAttribute('data-tooltip', 'Copy locator')
  pinBtn.setAttribute('aria-label', 'Copy Locator')
  pinBtn.innerHTML = PIN_SVG + ' <span>Copy Locator</span>'
  pinBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    playSound('click')
    setPinMode(!pinModeActive)
  })

  const sep1 = document.createElement('div')
  sep1.className = 'separator'

  // Record / stop button (always visible, changes icon + label based on state)
  const recordBtn = document.createElement('button')
  recordBtn.className = 'record-btn'

  function updateRecordBtn(): void {
    recordBtn.classList.remove('active', 'loading')
    if (isRecording) {
      recordBtn.innerHTML = STOP_SVG + ' <span>Stop recording\u2026</span>'
      recordBtn.setAttribute('data-tooltip', 'Stop recording')
      recordBtn.classList.add('active')
      return
    }
    if (startInFlight) {
      recordBtn.innerHTML = SPINNER_SVG + ' <span>Starting\u2026</span>'
      recordBtn.setAttribute('data-tooltip', 'Starting recorder')
      recordBtn.classList.add('loading')
      return
    }
    recordBtn.innerHTML = RECORD_SVG + ' <span>Record Skill</span>'
    recordBtn.setAttribute('data-tooltip', 'Record a skill')
  }
  updateRecordBtn()

  function setRecording(recording: boolean): void {
    startInFlight = false
    if (isRecording !== recording) {
      isRecording = recording
      if (recording) {
        setPinMode(false)
      }
    }
    updateRecordBtn()
    if (recording && pendingStop) {
      pendingStop = false
      window.__playwriterToolbarStopRecording?.()
      return
    }
    if (!recording) {
      pendingStop = false
    }
  }

  recordBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (!isTrustedToolbarClick(e)) {
      return
    }
    if (isRecording) {
      playSound('click')
      window.__playwriterToolbarStopRecording?.()
      return
    }
    if (startInFlight) {
      pendingStop = true
      return
    }
    if (!window.__playwriterToolbarStartRecording) {
      showToast('Relay not connected')
      return
    }
    playSound('record')
    startInFlight = true
    updateRecordBtn()
    window.__playwriterToolbarStartRecording()
  })

  const sep2 = document.createElement('div')
  sep2.className = 'separator'

  // Remote control: share the browser via a secret tunnel id. While sharing, the
  // button is a dropdown (copy prompt, copy id, or stop sharing). See remote-tunnel.ts.
  let remoteActive = false
  const REMOTE_SECURITY_URL = 'https://playwriter.dev/docs/remote-control'
  const remoteBtn = document.createElement('button')
  remoteBtn.className = 'record-btn remote-btn'

  const remoteMenu = document.createElement('div')
  remoteMenu.className = 'remote-panel'
  remoteMenu.setAttribute('role', 'menu')
  // TODO: re-enable Copy remote URL when viewer playback is fast enough.
  // Keep remoteControlCopyUrl in background.ts; hide the button so the live-view
  // link is not discoverable.
  // const copyUrlItem = document.createElement('button')
  // copyUrlItem.setAttribute('role', 'menuitem')
  // copyUrlItem.innerHTML = LINK_SVG + ' <span>Copy remote URL</span>'
  const copyPromptItem = document.createElement('button')
  copyPromptItem.setAttribute('role', 'menuitem')
  copyPromptItem.innerHTML = CLIPBOARD_SVG + ' <span>Copy agent prompt</span>'
  const copyIdItem = document.createElement('button')
  copyIdItem.setAttribute('role', 'menuitem')
  copyIdItem.innerHTML = HASH_SVG + ' <span>Copy id</span>'
  const stopShareItem = document.createElement('button')
  stopShareItem.setAttribute('role', 'menuitem')
  stopShareItem.className = 'danger'
  stopShareItem.innerHTML = CLOUD_OFF_SVG + ' <span>Stop sharing</span>'
  // remoteMenu.appendChild(copyUrlItem)
  remoteMenu.appendChild(copyPromptItem)
  remoteMenu.appendChild(copyIdItem)
  remoteMenu.appendChild(stopShareItem)

  const remoteDialog = document.createElement('div')
  remoteDialog.className = 'remote-panel'
  remoteDialog.setAttribute('role', 'dialog')
  remoteDialog.setAttribute('aria-label', 'Share browser')
  const dialogText = document.createElement('p')
  const dialogMore = document.createElement('a')
  dialogMore.href = REMOTE_SECURITY_URL
  dialogMore.target = '_blank'
  dialogMore.rel = 'noopener noreferrer'
  dialogMore.textContent = 'Read more'
  dialogText.append(
    'Share your browser? Anyone with the copied id can control all Playwriter tabs and open new ones. ',
    dialogMore,
  )
  const dialogActions = document.createElement('div')
  dialogActions.className = 'remote-panel-actions'
  const dialogCancel = document.createElement('button')
  dialogCancel.textContent = 'Cancel'
  const dialogShare = document.createElement('button')
  dialogShare.className = 'primary'
  dialogShare.textContent = 'Share'
  dialogActions.appendChild(dialogCancel)
  dialogActions.appendChild(dialogShare)
  remoteDialog.appendChild(dialogText)
  remoteDialog.appendChild(dialogActions)

  stack.appendChild(remoteMenu)
  stack.appendChild(remoteDialog)

  function setTooltipsEnabled(enabled: boolean): void {
    stack.classList.toggle('tooltips-disabled', !enabled)
  }

  function hideRemotePanels(): void {
    remoteMenu.classList.remove('open')
    remoteDialog.classList.remove('open')
    remoteBtn.classList.remove('menu-open')
    setTooltipsEnabled(true)
    if (remoteActive) {
      remoteBtn.setAttribute('aria-expanded', 'false')
      remoteBtn.setAttribute('data-tooltip', 'Remote options')
    } else {
      remoteBtn.setAttribute('data-tooltip', 'Share browser')
    }
  }

  function alignRemotePanel(panel: HTMLElement): void {
    const bar = toolbarEl.getBoundingClientRect()
    const btn = remoteBtn.getBoundingClientRect()
    panel.style.marginRight = Math.max(0, bar.right - btn.right) + 'px'
  }

  function showRemotePanel(panel: HTMLElement): void {
    hideRemotePanels()
    panel.classList.add('open')
    alignRemotePanel(panel)
    setTooltipsEnabled(false)
    remoteBtn.removeAttribute('data-tooltip')
    if (panel === remoteMenu) {
      remoteBtn.classList.add('menu-open')
      remoteBtn.setAttribute('aria-expanded', 'true')
    }
  }

  function updateRemoteBtn(): void {
    remoteBtn.classList.toggle('remote-active', remoteActive)
    if (remoteActive) {
      remoteBtn.innerHTML = CLOUD_SVG + ' <span>Remote ON</span>' + CHEVRON_SVG
      remoteBtn.setAttribute('data-tooltip', 'Remote options')
      remoteBtn.setAttribute('aria-label', 'Remote control options')
      remoteBtn.setAttribute('aria-haspopup', 'menu')
      remoteBtn.setAttribute('aria-expanded', 'false')
      return
    }
    remoteBtn.innerHTML = CLOUD_SVG + ' <span>Remote control</span>'
    remoteBtn.setAttribute('data-tooltip', 'Share browser')
    remoteBtn.setAttribute('aria-label', 'Start remote control')
    remoteBtn.removeAttribute('aria-haspopup')
    remoteBtn.removeAttribute('aria-expanded')
  }
  updateRemoteBtn()

  function setRemote(active: boolean): void {
    remoteActive = active
    hideRemotePanels()
    updateRemoteBtn()
  }

  remoteBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (!isTrustedToolbarClick(e)) {
      return
    }
    playSound('click')
    if (remoteActive) {
      if (!window.__playwriterToolbarStopRemote) {
        showToast('Extension not connected')
        return
      }
      if (remoteMenu.classList.contains('open')) {
        hideRemotePanels()
        return
      }
      showRemotePanel(remoteMenu)
      return
    }
    if (!window.__playwriterToolbarStartRemote) {
      showToast('Extension not connected')
      return
    }
    if (remoteDialog.classList.contains('open')) {
      hideRemotePanels()
      return
    }
    showRemotePanel(remoteDialog)
  })

  // TODO: re-enable Copy remote URL when viewer playback is fast enough.
  // copyUrlItem.addEventListener('click', (e: MouseEvent) => {
  //   e.stopPropagation()
  //   if (!isTrustedToolbarClick(e)) {
  //     return
  //   }
  //   playSound('click')
  //   hideRemotePanels()
  //   void chrome.runtime.sendMessage({ action: 'remoteControlCopyUrl' })
  // })

  copyPromptItem.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (!isTrustedToolbarClick(e)) {
      return
    }
    playSound('click')
    hideRemotePanels()
    void chrome.runtime.sendMessage({ action: 'remoteControlCopyPrompt' })
  })

  copyIdItem.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (!isTrustedToolbarClick(e)) {
      return
    }
    playSound('click')
    hideRemotePanels()
    void chrome.runtime.sendMessage({ action: 'remoteControlCopyId' })
  })

  stopShareItem.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (!isTrustedToolbarClick(e)) {
      return
    }
    hideRemotePanels()
    if (!window.__playwriterToolbarStopRemote) {
      showToast('Extension not connected')
      return
    }
    window.__playwriterToolbarStopRemote()
  })

  dialogCancel.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    hideRemotePanels()
  })

  dialogShare.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (!isTrustedToolbarClick(e)) {
      return
    }
    hideRemotePanels()
    if (!window.__playwriterToolbarStartRemote) {
      showToast('Extension not connected')
      return
    }
    window.__playwriterToolbarStartRemote()
  })

  toolbarEl.addEventListener('click', (e: MouseEvent) => {
    const target = e.target
    if (!(target instanceof Node)) {
      return
    }
    if (remoteBtn === target || remoteBtn.contains(target)) {
      return
    }
    hideRemotePanels()
  })

  function onDocMouseDown(e: MouseEvent): void {
    if (isOverToolbar(e)) {
      return
    }
    hideRemotePanels()
  }
  document.addEventListener('mousedown', onDocMouseDown, true)

  function onRemoteKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      hideRemotePanels()
    }
  }
  document.addEventListener('keydown', onRemoteKeyDown, true)

  const sep3 = document.createElement('div')
  sep3.className = 'separator'

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.className = 'btn'
  closeBtn.setAttribute('data-tooltip', 'Hide toolbar')
  closeBtn.setAttribute('aria-label', 'Hide toolbar')
  closeBtn.innerHTML = CLOSE_SVG
  closeBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    playSound('click')
    setPinMode(false)
    host.style.display = 'none'
  })

  // Drag handle
  const dragHandle = document.createElement('div')
  dragHandle.className = 'drag-handle'
  dragHandle.setAttribute('data-tooltip', 'Drag to move')
  dragHandle.setAttribute('aria-label', 'Drag to move')
  dragHandle.innerHTML = DRAG_SVG

  // ── Drag behavior ─────────────────────────────────────────────────────────

  let dragOffset = { x: 0, y: 0 }

  function onDragMouseDown(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    isDragging = true
    dragHandle.classList.add('dragging')
    const hostRect = host.getBoundingClientRect()
    // Offset from the center of the toolbar (since transform:translateX(-50%))
    dragOffset.x = e.clientX - (hostRect.left + hostRect.width / 2)
    dragOffset.y = e.clientY - hostRect.top
    document.addEventListener('mousemove', onDragMouseMove, true)
    document.addEventListener('mouseup', onDragMouseUp, true)
  }

  function onDragMouseMove(e: MouseEvent): void {
    if (!isDragging) return
    // Use rounded pixel values during drag to avoid sub-pixel jitter from
    // percentage + translateX(-50%) rounding on each frame.
    const leftPx = Math.round(e.clientX - dragOffset.x)
    const topPx = Math.round(e.clientY - dragOffset.y)
    const clampedLeft = Math.max(0, Math.min(window.innerWidth, leftPx))
    const clampedTop = Math.max(0, Math.min(window.innerHeight - 40, topPx))
    intendedLeft = clampedLeft + 'px'
    intendedTop = clampedTop + 'px'
    host.style.left = intendedLeft
    host.style.top = intendedTop
  }

  function onDragMouseUp(): void {
    if (!isDragging) return
    isDragging = false
    dragHandle.classList.remove('dragging')
    document.removeEventListener('mousemove', onDragMouseMove, true)
    document.removeEventListener('mouseup', onDragMouseUp, true)
    // Convert final pixel position to viewport percentages for persistence
    const leftPct = (parseFloat(host.style.left) / window.innerWidth) * 100
    const topPct = (parseFloat(host.style.top) / window.innerHeight) * 100
    if (!isNaN(leftPct) && !isNaN(topPct)) {
      savePosition(leftPct, topPct)
    }
  }

  dragHandle.addEventListener('mousedown', onDragMouseDown)

  // ── Render toolbar ──────────────────────────────────────────────────────────

  function renderToolbar(): void {
    toolbarEl.innerHTML = ''
    toolbarEl.appendChild(pinBtn)
    toolbarEl.appendChild(sep1)
    toolbarEl.appendChild(recordBtn)
    toolbarEl.appendChild(sep2)
    toolbarEl.appendChild(remoteBtn)
    toolbarEl.appendChild(sep3)
    toolbarEl.appendChild(closeBtn)
    toolbarEl.appendChild(dragHandle)
  }

  renderToolbar()

  // Never focusable: agent keyboard input (Tab, Enter, Space) must not reach the
  // toolbar. preventDefault on mousedown stops a user click from focusing a
  // button, which would let a later agent Enter press activate it.
  stack.querySelectorAll<HTMLElement>('button, a').forEach((el) => {
    el.tabIndex = -1
  })
  stack.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault()
  })

  // Attach host to the document (appended to <html> so it survives body rewrites)
  document.documentElement.appendChild(host)
  document.documentElement.appendChild(toastHost)

  // ── Globals exposed for background.ts to call via executeScript ─────────────

  window.__playwriterToolbarShowToast = function (msg: string): void {
    showToast(msg)
  }

  window.__playwriterToolbarPlaySound = function (name: string): void {
    playSound(name)
  }

  window.__playwriterToolbarSetRecording = setRecording

  window.__playwriterToolbarSetRemote = setRemote

  window.__playwriterToolbarStartRecording = () => {
    void chrome.runtime.sendMessage({ action: 'actionRecorderStart' })
  }

  window.__playwriterToolbarStopRecording = () => {
    void chrome.runtime.sendMessage({ action: 'actionRecorderStop' })
  }

  window.__playwriterToolbarStartRemote = () => {
    void chrome.runtime.sendMessage({ action: 'remoteControlStart' })
  }

  window.__playwriterToolbarStopRemote = () => {
    void chrome.runtime.sendMessage({ action: 'remoteControlStop' })
  }

  // ── Cleanup hook called by background.ts on tab disconnect ─────────────────

  window.__playwriterToolbarDestroy = function (): void {
    setPinMode(false)
    hideRemotePanels()
    document.removeEventListener('mousedown', onDocMouseDown, true)
    document.removeEventListener('keydown', onRemoteKeyDown, true)
    removeOverlay()
    host.remove()
    toastHost.remove()
    delete window.__playwriterToolbarInstalled
    delete window.__playwriterToolbarDestroy
    delete window.__playwriterToolbarSetRecording
    delete window.__playwriterToolbarStopRecording
    delete window.__playwriterToolbarStartRecording
    delete window.__playwriterToolbarSetRemote
    delete window.__playwriterToolbarStartRemote
    delete window.__playwriterToolbarStopRemote
    delete window.__playwriterToolbarShowToast
    delete window.__playwriterToolbarPlaySound
  }
}
