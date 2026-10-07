// CDP screencast viewer: streams Page.screencastFrame JPEG images onto a canvas and
// relays mouse/keyboard input back via Input.dispatch* commands.
// Inspired by RedPlanetHQ/core's cdp-viewer.
//
// Two transports are supported:
//   'raw'       a Chrome DevTools Protocol WebSocket (cloud browsers)
//   'extension' a Playwriter remote-control tunnel, which wraps CDP in the
//               extension protocol (see playwriter/src/remote-control.ts)
//
// The transports also differ in how the page session is found and in how much the
// viewer is allowed to change. A cloud browser is ours to resize; a shared tab
// belongs to a real person, so 'extension' never overrides device metrics.
'use client'

import {
  decodeExtensionCdpMessage,
  encodeExtensionCdpCommand,
  readAttachedTargetSession,
} from 'playwriter/src/remote-control'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../lib/utils.ts'

type CdpTransport = 'raw' | 'extension'

// ── CdpClient ──────────────────────────────────────────────────────
// Minimal CDP client over a browser WebSocket. Handles id-based request/response
// correlation and per-sessionId event subscriptions.

type CdpListener = (method: string, params: unknown) => void

class CdpClient {
  private nextId = 1
  private pending = new Map<number, (msg: { result?: unknown; error?: { message: string } }) => void>()
  private listeners = new Map<string, Set<CdpListener>>()

  constructor(
    private ws: WebSocket,
    private transport: CdpTransport,
  ) {
    try {
      ws.binaryType = 'arraybuffer'
    } catch {
      /* some environments don't allow setting after construction */
    }
    ws.addEventListener('message', (e) => {
      this.onMessage(e)
    })
    // Reject all pending requests on socket close so they don't hang forever
    ws.addEventListener('close', () => {
      const err = new Error('WebSocket closed')
      for (const resolve of this.pending.values()) {
        resolve({ error: { message: err.message } })
      }
      this.pending.clear()
    })
  }

  private async onMessage(e: MessageEvent): Promise<void> {
    let data: string
    if (typeof e.data === 'string') {
      data = e.data
    } else if (e.data instanceof ArrayBuffer) {
      data = new TextDecoder().decode(e.data)
    } else if (typeof Blob !== 'undefined' && e.data instanceof Blob) {
      data = await e.data.text()
    } else {
      return
    }

    if (this.transport === 'extension') {
      this.onExtensionMessage(data)
      return
    }

    let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string }
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }

    // Response to a send() call
    if (typeof msg.id === 'number') {
      const r = this.pending.get(msg.id)
      if (r) {
        this.pending.delete(msg.id)
        r({ result: msg.result, error: msg.error })
      }
      return
    }

    this.emit(msg.sessionId ?? '', msg.method!, msg.params)
  }

  private onExtensionMessage(data: string): void {
    const decoded = decodeExtensionCdpMessage(data)
    if (decoded.kind === 'response') {
      const r = this.pending.get(decoded.id)
      if (r) {
        this.pending.delete(decoded.id)
        // The extension reports errors as a plain string, not { message }.
        r({ result: decoded.result, error: decoded.error ? { message: decoded.error } : undefined })
      }
      return
    }
    if (decoded.kind === 'event') {
      this.emit(decoded.sessionId, decoded.method, decoded.params)
    }
  }

  private emit(sessionId: string, method: string, params: unknown): void {
    const subs = this.listeners.get(sessionId)
    if (subs) {
      for (const sub of subs) sub(method, params)
    }
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++
    const frame =
      this.transport === 'extension'
        ? encodeExtensionCdpCommand({ id, method, params, sessionId })
        : JSON.stringify({ id, method, params, sessionId })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.error) {
          reject(new Error(msg.error.message))
        } else {
          resolve(msg.result as T)
        }
      })
      this.ws.send(frame)
    })
  }

  on(sessionId: string, listener: CdpListener): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => set!.delete(listener)
  }
}

/**
 * Find the page session to drive.
 *
 * raw: discover targets and attach ourselves.
 * extension: right after `hello` the extension pushes `Target.attachedToTarget`
 * for every attached tab, the tab where sharing started first. We show that first
 * one. There is nothing to attach to, and `Target.attachToTarget` is not part of
 * the extension surface.
 */
function attachToPage({ cdp, transport, timeoutMs = 15_000 }: { cdp: CdpClient; transport: CdpTransport; timeoutMs?: number }): Promise<{ sessionId: string; url: string }> {
  if (transport === 'raw') {
    return (async () => {
      await cdp.send('Target.setDiscoverTargets', { discover: true })
      const { targetInfos } = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string; url?: string }> }>('Target.getTargets')
      const pageTarget = targetInfos.find((t) => {
        return t.type === 'page'
      })
      if (!pageTarget) throw new Error('No page target found')
      const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })
      return { sessionId, url: pageTarget.url || '' }
    })()
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error('The shared tab never announced itself. The link may have been revoked.'))
    }, timeoutMs)
    const off = cdp.on('', (method, params) => {
      const attached = readAttachedTargetSession({ kind: 'event', method, sessionId: '', params })
      if (!attached) return
      clearTimeout(timer)
      off()
      resolve(attached)
    })
  })
}

/** Bitmask matching CDP Input.dispatchKeyEvent.modifiers. */
function eventModifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

function mouseButtonName(button: number): 'left' | 'middle' | 'right' {
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return 'left'
}

/** CDP `buttons` is the pressed-button bitmask. Playwright always sends it; default 0 drops clicks. */
function pressedButtonsMask(e: { button: number; buttons: number }, type: string): number {
  if (e.buttons) return e.buttons
  if (type !== 'mousePressed') return 0
  if (e.button === 1) return 4
  if (e.button === 2) return 2
  return 1
}

// ── Mac editor command mapping ─────────────────────────────────────
// AppKit translates Cmd+Backspace, Alt+Left, etc. before the renderer sees
// them. Headless Chromium only gets raw key+modifiers, so we attach Blink
// editor command names explicitly via CDP's `commands` array.

function macEditorCommands(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): string[] {
  const sel = e.shiftKey ? 'AndModifySelection' : ''
  if (e.metaKey && !e.ctrlKey && !e.altKey) {
    switch (e.key) {
      case 'Backspace':
        return ['DeleteToBeginningOfLine']
      case 'Delete':
        return ['DeleteToEndOfLine']
      case 'ArrowLeft':
        return [`MoveToBeginningOfLine${sel}`]
      case 'ArrowRight':
        return [`MoveToEndOfLine${sel}`]
      case 'ArrowUp':
        return [`MoveToBeginningOfDocument${sel}`]
      case 'ArrowDown':
        return [`MoveToEndOfDocument${sel}`]
    }
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    switch (e.key) {
      case 'Backspace':
        return ['DeleteWordBackward']
      case 'Delete':
        return ['DeleteWordForward']
      case 'ArrowLeft':
        return [`MoveWordLeft${sel}`]
      case 'ArrowRight':
        return [`MoveWordRight${sel}`]
    }
  }
  return []
}

// ── useCdpScreencast hook ──────────────────────────────────────────

type ScreencastStatus = 'connecting' | 'running' | 'ended' | 'error'

interface ScreencastFrameParams {
  data: string // base64 jpeg
  sessionId: number // CDP screencast ack id (not Target sessionId)
  metadata: {
    deviceWidth?: number
    deviceHeight?: number
  }
}

interface Viewport {
  width: number
  height: number
  dpr: number
}

interface NavigationHistory {
  currentIndex: number
  entries: Array<{ id: number }>
}

function screencastParams({
  quality,
  maxWidth,
  maxHeight,
  everyNthFrame = 2,
}: {
  quality: number
  maxWidth: number
  maxHeight: number
  everyNthFrame?: number
}): Record<string, unknown> {
  return { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame }
}

// Shared-tab stream: CDP has no fps field, only everyNthFrame. Cap CSS pixels, never
// device pixels, or a Retina tab encodes 4x as many JPEG bytes.
const REMOTE_SCREENCAST = { quality: 50, maxWidth: 960, maxHeight: 960, everyNthFrame: 3 }

function decodeJpegBase64(base64: string): Uint8Array {
  const fromBase64 = (Uint8Array as { fromBase64?: (value: string) => Uint8Array }).fromBase64
  if (fromBase64) {
    return fromBase64(base64)
  }
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

/**
 * Connect to Chrome DevTools Protocol over WebSocket and stream
 * Page.screencastFrame images into a canvas. Exposes mouse/keyboard
 * dispatch helpers for interactive control.
 *
 * Flow:
 *   1. Open WebSocket -> wrap with CdpClient
 *   2. Target.setDiscoverTargets + Target.getTargets -> find page target
 *   3. Target.attachToTarget {flatten:true} -> get sessionId
 *   4. Page.enable for navigation events
 *   5. Wire Page.screencastFrame listener
 *   6. Page.startScreencast -> Chromium begins emitting JPEG frames
 *   7. Each frame ack'd via Page.screencastFrameAck
 */
function useCdpScreencast({ wsUrl, transport = 'raw', quality = 70, maxWidth = 1280 }: { wsUrl: string; transport?: CdpTransport; quality?: number; maxWidth?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageSessionRef = useRef<{ cdp: CdpClient; sessionId: string } | null>(null)
  const viewportRef = useRef<Viewport | null>(null)

  const [status, setStatus] = useState<ScreencastStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [pageUrl, setPageUrl] = useState<string>('')
  const [reconnectKey, setReconnectKey] = useState(0)

  const sendToPage = useCallback((method: string, params: Record<string, unknown> = {}) => {
    const pageSession = pageSessionRef.current
    if (!pageSession) return
    pageSession.cdp.send(method, params, pageSession.sessionId).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setStatus('connecting')
    setErrorMsg('')

    // Paint only the latest JPEG. createImageBitmap is async; without this, frames queue and show late.
    let latestJpeg: string | null = null
    let painting = false
    const paintJpegBase64 = (base64: string): void => {
      latestJpeg = base64
      if (painting) {
        return
      }
      painting = true
      const paintLatest = (): void => {
        const data = latestJpeg
        latestJpeg = null
        if (!data) {
          painting = false
          return
        }
        createImageBitmap(new Blob([decodeJpegBase64(data)], { type: 'image/jpeg' }))
          .then((bm) => {
            if (cancelled) {
              bm.close()
              painting = false
              return
            }
            const c = canvasRef.current
            if (!c) {
              bm.close()
              painting = false
              return
            }
            if (c.width !== bm.width || c.height !== bm.height) {
              c.width = bm.width
              c.height = bm.height
            }
            c.getContext('2d')?.drawImage(bm, 0, 0)
            bm.close()
            if (latestJpeg) {
              paintLatest()
              return
            }
            painting = false
          })
          .catch(() => {
            painting = false
          })
      }
      paintLatest()
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : `Invalid WebSocket URL: ${wsUrl}`)
      return
    }
    const cdp = new CdpClient(ws, transport)

    ws.addEventListener('error', () => {
      if (cancelled) return
      setStatus('error')
      setErrorMsg('Connection error')
    })
    ws.addEventListener('close', () => {
      if (cancelled) return
      setStatus((s) => {
        return s === 'error' ? s : 'ended'
      })
    })

    ws.addEventListener('open', async () => {
      if (cancelled) return
      try {
        const { sessionId, url: targetUrl } = await attachToPage({ cdp, transport })
        if (cancelled) return
        pageSessionRef.current = { cdp, sessionId }

        await cdp.send('Page.enable', {}, sessionId)
        if (targetUrl && !cancelled) setPageUrl(targetUrl)

        // Track navigation
        cdp.on(sessionId, (method, params) => {
          if (method !== 'Page.frameNavigated') return
          const p = params as { frame: { id: string; parentId?: string; url: string } }
          if (!p.frame.parentId && !cancelled) setPageUrl(p.frame.url)
        })

        // Wire frame listener BEFORE startScreencast (Chromium can emit first frame synchronously)
        cdp.on(sessionId, (method, params) => {
          if (method !== 'Page.screencastFrame') return
          const p = params as ScreencastFrameParams
          // Ack immediately so Chromium keeps shipping frames
          cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, sessionId).catch(() => {})

          // A shared tab keeps its own size, so learn the viewport from the frame
          // instead of forcing one. Input coordinates are mapped against this.
          if (transport === 'extension' && p.metadata.deviceWidth && p.metadata.deviceHeight) {
            const prev = viewportRef.current
            if (!prev || prev.width !== p.metadata.deviceWidth || prev.height !== p.metadata.deviceHeight) {
              viewportRef.current = { width: p.metadata.deviceWidth, height: p.metadata.deviceHeight, dpr: 1 }
            }
          }

          // Decode off main thread via createImageBitmap (avoids base64 data URL jank)
          paintJpegBase64(p.data)
        })

        // Only a cloud browser may be resized. Overriding device metrics on a
        // shared tab would visibly resize the page of the person sharing it.
        const v = transport === 'raw' ? viewportRef.current : null
        if (v) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: false }, sessionId)
        }

        await cdp.send(
          'Page.startScreencast',
          transport === 'extension'
            ? screencastParams(REMOTE_SCREENCAST)
            : screencastParams({
                quality,
                maxWidth: v ? Math.ceil(v.width * v.dpr) : maxWidth,
                maxHeight: v ? Math.ceil(v.height * v.dpr) : maxWidth * 2,
              }),
          sessionId,
        )

        if (!cancelled) setStatus('running')

      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : String(err))
      }
    })

    return () => {
      cancelled = true
      if (pageSessionRef.current?.cdp === cdp) {
        pageSessionRef.current = null
      }
      try {
        ws.close()
      } catch {}
    }
  }, [wsUrl, transport, reconnectKey, quality, maxWidth])

  // ── Navigation helpers ──────────────────────────────────────────

  const coerceUrl = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
    if (/^[^\s/]+\.[^\s/]+/i.test(trimmed) && !trimmed.includes(' ')) {
      return `https://${trimmed}`
    }
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  }

  const navigate = (url: string) => {
    const target = coerceUrl(url)
    if (!target) return
    sendToPage('Page.navigate', { url: target })
  }

  const reload = () => {
    sendToPage('Page.reload')
  }

  const stepHistory = async (delta: -1 | 1): Promise<void> => {
    const pageSession = pageSessionRef.current
    if (!pageSession) return
    try {
      const hist = await pageSession.cdp.send<NavigationHistory>('Page.getNavigationHistory', {}, pageSession.sessionId)
      const target = hist.entries[hist.currentIndex + delta]
      if (!target) return
      await pageSession.cdp.send('Page.navigateToHistoryEntry', { entryId: target.id }, pageSession.sessionId)
    } catch {}
  }

  const goBack = () => {
    void stepHistory(-1)
  }
  const goForward = () => {
    void stepHistory(1)
  }

  // ── Input dispatch ──────────────────────────────────────────────

  // CDP Input.dispatchMouseEvent expects CSS pixels of the remote viewport, not
  // DPR-scaled bitmap pixels. The canvas also uses object-contain, so the image is
  // letterboxed inside the element whenever the aspect ratios differ. That happens
  // constantly in 'extension' mode, where the tab keeps its own size because we are
  // not allowed to resize someone else's page. Map the pointer into the drawn image
  // rather than the element, otherwise every click lands offset.
  const toViewportCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport || !canvas.width || !canvas.height) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null

    const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height)
    const jpegCssW = canvas.width * fit
    const jpegCssH = canvas.height * fit
    const jpegLeft = rect.left + (rect.width - jpegCssW) / 2
    const jpegTop = rect.top + (rect.height - jpegCssH) / 2

    // Chrome may pad the JPEG to maxWidth/maxHeight. Map through the page
    // rectangle inside that bitmap, not the padded frame.
    const jpegAspect = canvas.width / canvas.height
    const pageAspect = viewport.width / viewport.height
    let contentCssW = jpegCssW
    let contentCssH = jpegCssH
    if (jpegAspect > pageAspect) {
      contentCssW = jpegCssH * pageAspect
    } else if (jpegAspect < pageAspect) {
      contentCssH = jpegCssW / pageAspect
    }
    const contentLeft = jpegLeft + (jpegCssW - contentCssW) / 2
    const contentTop = jpegTop + (jpegCssH - contentCssH) / 2
    if (contentCssW <= 0 || contentCssH <= 0) return null
    const x = ((clientX - contentLeft) / contentCssW) * viewport.width
    const y = ((clientY - contentTop) / contentCssH) * viewport.height
    if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null
    return { x, y }
  }

  const dispatchMouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = toViewportCoords(e.clientX, e.clientY)
    if (!point) return

    sendToPage('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: type === 'mouseMoved' ? 'none' : mouseButtonName(e.button),
      buttons: pressedButtonsMask(e, type),
      clickCount: type === 'mouseReleased' || type === 'mousePressed' ? 1 : 0,
      modifiers: eventModifiers(e),
    })
  }

  const dispatchWheel = (e: WheelEvent) => {
    const point = toViewportCoords(e.clientX, e.clientY)
    if (!point) return

    const lineHeight = 16
    const pageHeight = canvasRef.current?.getBoundingClientRect().height || 800
    const factor = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? pageHeight : 1

    sendToPage('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: e.deltaX * factor,
      deltaY: e.deltaY * factor,
      modifiers: eventModifiers(e),
    })
  }

  const setViewport = useCallback(
    (width: number, height: number, dpr: number) => {
      const dprSafe = dpr > 0 ? dpr : 1
      const w = Math.max(1, Math.floor(width))
      const h = Math.max(1, Math.floor(height))

      // A shared tab owns its size. Never write viewportRef here in extension mode:
      // it is filled from the screencast metadata and drives input coordinates.
      // Do not recast at the viewer container size: that pads the JPEG to a square
      // and makes click mapping miss the page.
      if (transport === 'extension') {
        if (!viewportRef.current) return
        sendToPage('Page.startScreencast', screencastParams(REMOTE_SCREENCAST))
        return
      }

      const params = screencastParams({ quality, maxWidth: Math.ceil(w * dprSafe), maxHeight: Math.ceil(h * dprSafe) })

      const prev = viewportRef.current
      if (prev && prev.width === w && prev.height === h && prev.dpr === dprSafe) return
      viewportRef.current = { width: w, height: h, dpr: dprSafe }

      sendToPage('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dprSafe, mobile: false })
      // Re-issue screencast at new resolution
      sendToPage('Page.startScreencast', params)
    },
    [quality, sendToPage, transport],
  )

  const dispatchKey = (type: 'keyDown' | 'keyUp' | 'char', e: KeyboardEvent) => {
    const isPrintable = e.key.length === 1
    const cdpType = type === 'keyDown' && isPrintable ? 'rawKeyDown' : type
    const params: Record<string, unknown> = {
      type: cdpType,
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      modifiers: eventModifiers(e),
    }
    if (isPrintable) params.text = e.key
    if (type === 'keyDown') {
      const commands = macEditorCommands(e)
      if (commands.length > 0) params.commands = commands
    }
    sendToPage('Input.dispatchKeyEvent', params)
  }

  return {
    status,
    errorMsg,
    canvasRef,
    pageUrl,
    navigate,
    goBack,
    goForward,
    reload,
    dispatchMouse,
    dispatchWheel,
    dispatchKey,
    reconnect: () => {
      setReconnectKey((k) => {
        return k + 1
      })
    },
    setViewport,
  }
}

// ── CdpViewer component ────────────────────────────────────────────

interface CdpViewerProps {
  wsUrl: string
  transport?: CdpTransport
  quality?: number
  maxWidth?: number
  initialControl?: boolean
}

export function CdpViewer({ wsUrl, transport = 'raw', quality = 70, maxWidth = 1280, initialControl = false }: CdpViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { status, errorMsg, canvasRef, pageUrl, navigate, goBack, goForward, reload, dispatchMouse, dispatchWheel, dispatchKey, reconnect, setViewport } =
    useCdpScreencast({ wsUrl, transport, quality, maxWidth })

  // Resize remote viewport to match container (debounced)
  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const apply = () => {
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setViewport(Math.floor(rect.width), Math.floor(rect.height), window.devicePixelRatio || 1)
    }

    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 150)
    })
    ro.observe(node)
    apply()

    return () => {
      if (timer) clearTimeout(timer)
      ro.disconnect()
    }
  }, [setViewport])

  const [hasControl, setHasControl] = useState(initialControl)
  const [urlInput, setUrlInput] = useState('')
  const urlInputRef = useRef<HTMLInputElement>(null)
  const isUrlFocusedRef = useRef(false)

  useEffect(() => {
    if (!isUrlFocusedRef.current) setUrlInput(pageUrl)
  }, [pageUrl])

  // Non-passive wheel on the whole viewer so the outer page never scrolls.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (hasControl) dispatchWheel(e)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      node.removeEventListener('wheel', onWheel)
    }
  }, [hasControl, dispatchWheel])

  const isRunning = status === 'running'

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-neutral-950 shadow-2xl shadow-black/50">
      {/* ── Toolbar ────────────────────────────────────────────── */}
      <form
        className="flex shrink-0 items-center gap-1.5 border-b border-white/10 bg-neutral-900 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!isRunning) return
          navigate(urlInput)
          urlInputRef.current?.blur()
        }}
      >
        {/* Traffic light dots */}
        <div className="mr-2 flex items-center gap-1.5">
          <div className="size-3 rounded-full bg-red-500/80" />
          <div className="size-3 rounded-full bg-yellow-500/80" />
          <div className="size-3 rounded-full bg-green-500/80" />
        </div>

        {/* Nav buttons */}
        <button
          type="button"
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="Back"
          onClick={goBack}
          disabled={!isRunning}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="Forward"
          onClick={goForward}
          disabled={!isRunning}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
        <button
          type="button"
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="Reload"
          onClick={reload}
          disabled={!isRunning}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </button>

        {/* URL bar */}
        <input
          ref={urlInputRef}
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value)
          }}
          onFocus={(e) => {
            isUrlFocusedRef.current = true
            e.currentTarget.select()
          }}
          onBlur={() => {
            isUrlFocusedRef.current = false
          }}
          placeholder={isRunning ? 'Enter URL or search...' : ''}
          disabled={!isRunning}
          className="mx-1.5 h-7 flex-1 rounded-md border border-white/10 bg-neutral-800 px-3 font-mono text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-white/25 disabled:opacity-40"
        />

        {/* Status + controls */}
        <div className="flex shrink-0 items-center gap-2 text-xs text-white/50">
          {status === 'connecting' && (
            <span className="flex items-center gap-1.5">
              <svg className="size-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
              Connecting...
            </span>
          )}
          {status === 'ended' && <span>Disconnected</span>}
          {status === 'error' && <span className="text-red-400">{errorMsg}</span>}
          {isRunning && (
            <button
              type="button"
              onClick={() => {
                const nextHasControl = !hasControl
                setHasControl(nextHasControl)
                if (nextHasControl) containerRef.current?.focus()
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition',
                hasControl ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white',
              )}
            >
              {hasControl ? 'Release' : 'Take control'}
            </button>
          )}
          {(status === 'ended' || status === 'error') && (
            <button type="button" onClick={reconnect} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70 transition hover:bg-white/15 hover:text-white">
              Reconnect
            </button>
          )}
        </div>
      </form>

      {/* ── Canvas area ────────────────────────────────────────── */}
      <div
        ref={containerRef}
        tabIndex={0}
        className={cn('relative min-h-0 flex-1 touch-none overflow-hidden bg-neutral-950 outline-none', hasControl ? 'cursor-crosshair' : 'cursor-default')}
        onKeyDown={(e) => {
          if (!hasControl) return
          e.preventDefault()
          dispatchKey('keyDown', e.nativeEvent)
          if (e.key.length === 1) dispatchKey('char', e.nativeEvent)
        }}
        onKeyUp={(e) => {
          if (!hasControl) return
          e.preventDefault()
          dispatchKey('keyUp', e.nativeEvent)
        }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full object-contain"
          onContextMenu={(e) => {
            if (hasControl) e.preventDefault()
          }}
          onMouseMove={(e) => {
            if (hasControl) dispatchMouse('mouseMoved', e)
          }}
          onMouseDown={(e) => {
            if (!hasControl) return
            // Restore keyboard focus to the container after clicking the canvas,
            // otherwise keys stop dispatching if user clicked the URL bar first
            containerRef.current?.focus()
            dispatchMouse('mousePressed', e)
          }}
          onMouseUp={(e) => {
            if (hasControl) dispatchMouse('mouseReleased', e)
          }}
        />
        {status === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <svg className="size-6 animate-spin text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            <span className="text-sm text-white/40">Connecting to browser...</span>
          </div>
        )}
        {status === 'ended' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-sm text-white/40">Session ended</span>
            <button onClick={reconnect} className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/15 hover:text-white">
              Reconnect
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-sm text-red-400">{errorMsg}</span>
            <button onClick={reconnect} className="rounded-md bg-white/10 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/15 hover:text-white">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
