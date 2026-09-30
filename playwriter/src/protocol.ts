import { CDPEventFor, ProtocolMapping } from './cdp-types.js'

export const VERSION = 1

export const INVENTORY_READY_CAPABILITY = 'inventory-ready-v1'

// Browser WebSocket.close() only allows 1000 or 3000-4999. 1011 throws InvalidAccessError.
export const EXTENSION_INVENTORY_TIMEOUT_CLOSE = 4005
export const EXTENSION_INVENTORY_FAILED_CLOSE = 4006

export function isBrowserAllowedWebSocketCloseCode(code: number): boolean {
  return code === 1000 || (code >= 3000 && code <= 4999)
}

// ============================================================================
// Tab groups. Each CLI session can have a custom tab group title (default
// 'playwriter', or 'remote' for remote-control sessions). The title travels
// with Target.createTarget / createInitialTab messages; the extension stores it
// per tab and derives Chrome group membership from it. Pure planning helpers
// live here so they are testable from the playwriter package.
// ============================================================================

export const DEFAULT_TAB_GROUP_TITLE = 'playwriter'
export const REMOTE_TAB_GROUP_TITLE = 'remote'

/** Normalize a user-provided tab group title. Returns null when unusable. */
export function normalizeTabGroupTitle(title: unknown): string | null {
  if (typeof title !== 'string') {
    return null
  }
  // Strip control/format characters so a title can't forge relay log lines.
  const trimmed = title.replace(/\p{C}/gu, ' ').trim()
  if (!trimmed) {
    return null
  }
  // Chrome truncates long titles visually; cap to keep messages/storage sane.
  return trimmed.slice(0, 80)
}

/** Mirrors chrome.tabGroups.Color — protocol.ts must not depend on chrome types. */
export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange'

/** Every color Chrome tab groups support, for --tab-group-color validation. */
export const TAB_GROUP_ALL_COLORS: TabGroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
]

/** Normalize a user-provided tab group color. Returns null when not a Chrome color.
 *  Takes unknown because values arrive from JSON bodies (a number must 400, not throw). */
export function normalizeTabGroupColor(color: unknown): TabGroupColor | null {
  if (typeof color !== 'string') {
    return null
  }
  const lowered = color.trim().toLowerCase()
  return TAB_GROUP_ALL_COLORS.find((c) => c === lowered) || null
}

/** Hash palette excludes green so auto-colored custom groups stand out from the default. */
const TAB_GROUP_COLORS: TabGroupColor[] = ['grey', 'blue', 'red', 'yellow', 'pink', 'purple', 'cyan', 'orange']

/** Deterministic color per group title. Default group stays green so custom groups stand out. */
export function colorForTabGroupTitle(title: string): TabGroupColor {
  if (title === DEFAULT_TAB_GROUP_TITLE) {
    return 'green'
  }
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0
  }
  return TAB_GROUP_COLORS[Math.abs(hash) % TAB_GROUP_COLORS.length]
}

export function shouldDisconnectAfterTabGroupChange(options: {
  currentGroupId: number
  /** Group ids of ALL playwriter-managed groups (default + per-session custom groups) */
  managedGroupIds: number[]
  tabState: 'connecting' | 'connected' | 'error' | undefined
}): boolean {
  const { currentGroupId, managedGroupIds, tabState } = options
  if (managedGroupIds.length === 0) {
    return false
  }
  if (tabState !== 'connected') {
    return false
  }
  return !managedGroupIds.includes(currentGroupId)
}

export function shouldUpdateTabGroupForTab({
  currentTitle,
  currentKey,
  from,
  key,
  remoteScoped = false,
}: {
  currentTitle: string
  currentKey?: string
  from: string
  key?: string
  remoteScoped?: boolean
}): boolean {
  if (remoteScoped) {
    return true
  }
  if (currentTitle !== from) {
    return false
  }
  if (from !== DEFAULT_TAB_GROUP_TITLE) {
    return true
  }
  return Boolean(key && currentKey === key)
}

export type TabGroupSyncInput = {
  /** Desired grouping: connected tab id → resolved group title */
  desiredTabs: Array<{ tabId: number; title: string }>
  /** Live Chrome groups whose title is playwriter-managed, with member tab ids.
   *  Order matters: the first group per title is kept, later ones are duplicates. */
  groups: Array<{ groupId: number; title: string; tabIds: number[] }>
  /** Tab ids playwriter ever grouped (tracked + persisted from previous syncs).
   *  Only these may be ungrouped — a user group whose title collides with a
   *  session's group name must never lose the user's own tabs. */
  ownedTabIds: number[]
}

export type TabGroupSyncPlan = {
  /** Tabs to remove from managed groups (disconnected leftovers) */
  ungroupTabIds: number[]
  /** Group these tabs under the title. groupId set = add to existing group
   *  (Chrome moves tabs out of their old group/window automatically),
   *  groupId undefined = create a new group. */
  groupOps: Array<{ title: string; tabIds: number[]; groupId?: number }>
  /** Existing groups that need their title/color enforced (Chrome can reset them) */
  updateOps: Array<{ groupId: number; title: string }>
}

/**
 * Pure planner for tab group sync. Data in, operations out — no chrome.* calls.
 * Invariants:
 * - Never touches tabs outside the provided managed groups.
 * - Never ungroups tabs playwriter didn't group itself (ownedTabIds) so user
 *   groups with a colliding title keep their own tabs.
 * - Duplicate groups with the same title are drained (first group wins).
 * - A tab desired under title A but sitting in managed group B is moved via a
 *   single group op (no intermediate ungroup, avoids flicker).
 * - Execute groupOps BEFORE ungroupTabIds: ungrouping first can empty the
 *   keeper group, Chrome deletes it, and the group op fails on a dead id.
 */
export function computeTabGroupSyncPlan(input: TabGroupSyncInput): TabGroupSyncPlan {
  const ownedTabIds = new Set(input.ownedTabIds)
  const desiredByTitle = new Map<string, number[]>()
  const desiredTitleByTab = new Map<number, string>()
  for (const { tabId, title } of input.desiredTabs) {
    desiredTitleByTab.set(tabId, title)
    desiredByTitle.set(title, [...(desiredByTitle.get(title) || []), tabId])
  }

  const keeperByTitle = new Map<string, { groupId: number; tabIds: number[] }>()
  const ungroupTabIds: number[] = []
  for (const group of input.groups) {
    const keeper = keeperByTitle.get(group.title)
    const isDuplicate = keeper !== undefined
    if (!isDuplicate) {
      keeperByTitle.set(group.title, { groupId: group.groupId, tabIds: group.tabIds })
    }
    for (const tabId of group.tabIds) {
      const desiredTitle = desiredTitleByTab.get(tabId)
      // Tab desired in this exact group: keep it (unless it sits in a duplicate,
      // then the group op below moves it into the keeper).
      if (desiredTitle === group.title && !isDuplicate) {
        continue
      }
      // Tab desired under another managed title: the group op for that title moves it.
      if (desiredTitle !== undefined && desiredTitle !== group.title) {
        continue
      }
      // Duplicate-group member desired under the same title: moved by the group op.
      if (desiredTitle === group.title && isDuplicate) {
        continue
      }
      // A user's own tab in a colliding group: hands off.
      if (!ownedTabIds.has(tabId)) {
        continue
      }
      // Not desired anywhere: leftover from a disconnected tab.
      ungroupTabIds.push(tabId)
    }
  }

  const groupOps: TabGroupSyncPlan['groupOps'] = []
  const updateOps: TabGroupSyncPlan['updateOps'] = []
  for (const [title, tabIds] of desiredByTitle) {
    const keeper = keeperByTitle.get(title)
    const alreadyInKeeper = new Set(keeper?.tabIds || [])
    const toAdd = tabIds.filter((tabId) => {
      return !alreadyInKeeper.has(tabId)
    })
    if (toAdd.length > 0) {
      groupOps.push({ title, tabIds: toAdd, ...(keeper ? { groupId: keeper.groupId } : {}) })
    } else if (keeper) {
      updateOps.push({ groupId: keeper.groupId, title })
    }
  }

  return { ungroupTabIds, groupOps, updateOps }
}

type ForwardCDPCommand = {
  [K in keyof ProtocolMapping.Commands]: {
    id: number
    method: 'forwardCDPCommand'
    params: {
      method: K
      sessionId?: string
      params?: ProtocolMapping.Commands[K]['paramsType'][0]
      source?: 'playwriter'
      /** Tab group title for Target.createTarget — which group the new tab joins.
       *  Old extensions ignore this field (tab lands in the default group). */
      tabGroup?: string
      /** Opaque session ownership key for Target.createTarget. Group titles are not
       *  identities — the key scopes `updateTabGroup` renames to the session's
       *  own tabs (a default-group rename must not steal manually toggled tabs). */
      tabGroupKey?: string
      /** Explicit tab group color chosen with --tab-group-color. When absent
       *  the group color is derived from the title hash (default group: green). */
      tabGroupColor?: TabGroupColor
    }
  }
}[keyof ProtocolMapping.Commands]

export type ExtensionCommandMessage = ForwardCDPCommand

export type ExtensionResponseMessage = {
  id: number
  method?: undefined
  result?: any
  error?: string
}

/**
 * This produces a discriminated union for narrowing, similar to ForwardCDPCommand,
 * but for forwarded CDP events. Uses CDPEvent to maintain proper type extraction.
 */
export type ExtensionEventMessage = {
  [K in keyof ProtocolMapping.Events]: {
    id?: undefined
    method: 'forwardCDPEvent'
    params: {
      method: CDPEventFor<K>['method']
      sessionId?: string
      params?: CDPEventFor<K>['params']
    }
  }
}[keyof ProtocolMapping.Events]

export type ExtensionLogMessage = {
  id?: undefined
  method: 'log'
  params: {
    level: 'log' | 'debug' | 'info' | 'warn' | 'error'
    args: string[]
  }
}

export type ExtensionPongMessage = {
  id?: undefined
  method: 'pong'
}

export type ServerPingMessage = {
  method: 'ping'
  id?: undefined
}

export type RecordingDataMessage = {
  id?: undefined
  method: 'recordingData'
  params: {
    tabId: number
    final?: boolean
  }
}

export type RecordingCancelledMessage = {
  id?: undefined
  method: 'recordingCancelled'
  params: {
    tabId: number
  }
}

export type ExtensionHelloMessage = {
  id?: undefined
  method: 'hello'
  params: {
    browser?: string
    email?: string
    id?: string
    installId?: string
    version?: string
    remote?: boolean
  }
}

export type ExtensionReadyMessage = {
  id?: undefined
  method: 'ready'
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionEventMessage
  | ExtensionLogMessage
  | ExtensionPongMessage
  | RecordingDataMessage
  | RecordingCancelledMessage
  | ExtensionHelloMessage
  | ExtensionReadyMessage

// Recording command messages (MCP -> Extension via relay)
export type StartRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to record. */
  sessionId?: string
  frameRate?: number
  audio?: boolean
  videoBitsPerSecond?: number
  audioBitsPerSecond?: number
}

/** HTTP body for /recording/start endpoint */
export type StartRecordingBody = StartRecordingParams & {
  outputPath: string
}

export type StopRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to stop recording. */
  sessionId?: string
}

export type IsRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to check. */
  sessionId?: string
}

export type CancelRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to cancel. */
  sessionId?: string
}

export type StartRecordingMessage = {
  id: number
  method: 'startRecording'
  params: StartRecordingParams
}

export type StopRecordingMessage = {
  id: number
  method: 'stopRecording'
  params: StopRecordingParams
}

export type IsRecordingMessage = {
  id: number
  method: 'isRecording'
  params: IsRecordingParams
}

export type CancelRecordingMessage = {
  id: number
  method: 'cancelRecording'
  params: CancelRecordingParams
}

export type RecordingCommandMessage =
  | StartRecordingMessage
  | StopRecordingMessage
  | IsRecordingMessage
  | CancelRecordingMessage

// Tab group command messages (relay -> extension)

/** Sent by the relay when a session's tab group is renamed via
 *  `playwriter session update`. Old extensions fall through their CDP handler
 *  and reply `{id}` with no result — the relay treats a missing `success` as
 *  "extension too old" and warns (the new name still applies to future tabs). */
export type UpdateTabGroupMessage = {
  id: number
  method: 'updateTabGroup'
  params: {
    from: string
    /** New title. Equal to `from` when only the color changes. */
    to: string
    /** Opaque session ownership key. Required to move default-group tabs: only tabs
     *  created by this session follow the rename out of the shared default group. */
    key?: string
    /** New explicit color for the group. Absent = keep the current color rule. */
    color?: TabGroupColor
  }
}

export type UpdateTabGroupResult = {
  success: boolean
  /** Number of tracked tabs whose group title was rewritten */
  movedTabs: number
}

/** Sent by the relay on `/cli/session/delete` with `closeCreatedTabs` (SDK `connection.close()`).
 *  Closes tabs whose groupKey is `key`: tabs the session created and popups they opened.
 *  Old extensions reply `{id}` with no result; the relay then warns and tabs stay open. */
export type CloseTabsForKeyMessage = {
  id: number
  method: 'closeTabsForKey'
  params: {
    /** Opaque session ownership key */
    key: string
  }
}

export type CloseTabsForKeyResult = {
  success: boolean
  closedTabs: number
}

export type CreateInitialTabParams = {
  /** Tab group title the auto-created tab joins (default 'playwriter') */
  tabGroup?: string
  /** Opaque session ownership key (see ForwardCDPCommand.tabGroupKey) */
  tabGroupKey?: string
  /** Explicit tab group color (see ForwardCDPCommand.tabGroupColor) */
  tabGroupColor?: TabGroupColor
}

// Recording result types
export type StartRecordingResult =
  | {
      success: true
      tabId: number
      startedAt: number
      mimeType?: string
    }
  | {
      success: false
      error: string
    }

/** Result from extension - doesn't include path/size since relay writes the file */
export type ExtensionStopRecordingResult =
  | {
      success: true
      tabId: number
      duration: number
    }
  | {
      success: false
      error: string
    }

/** Final result from relay - includes path/size after file is written */
export type StopRecordingResult =
  | {
      success: true
      tabId: number
      duration: number
      path: string
      size: number
    }
  | {
      success: false
      error: string
    }

export type IsRecordingResult = {
  isRecording: boolean
  tabId?: number
  startedAt?: number
}

export type CancelRecordingResult = {
  success: boolean
  error?: string
}

// ============================================================================
// Streaming types (HTTP-only, used by /stream/* endpoints).
// Streaming reuses the recording WS messages (startRecording/stopRecording/
// recordingData) so no WS protocol changes are needed and old extensions keep
// working. The relay pipes chunks to ffmpeg instead of accumulating them.
// ============================================================================

export type StartStreamParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to stream. */
  sessionId?: string
  /** RTMP destination URLs (or any ffmpeg-writable flv target, e.g. a file path for testing). */
  rtmpUrls: string[]
  /** Output resolution as WxH (default 1920x1080, X Live recommended). */
  resolution?: string
  /** Output frame rate (default 30). */
  fps?: number
  /** Video bitrate in kbps (default 9000, X Live recommended). */
  videoBitrateKbps?: number
  /** Audio bitrate in kbps (default 128). */
  audioBitrateKbps?: number
  /** Keyframe interval in seconds (default 3, X Live recommended and its max;
   *  Twitch recommends 2). */
  keyframeSeconds?: number
  /** Capture tab audio (default true). When false, a silent audio track is injected
   *  because platforms like X Live reject streams without audio. */
  audio?: boolean
  /** x264 preset (default veryfast). Only applies to libx264. */
  preset?: string
  /** Video codec for ffmpeg -c:v (default: auto-detect hardware encoder, falls back to libx264). */
  codec?: string
}

export type StartStreamResult =
  | {
      success: true
      tabId: number
      startedAt: number
      /** Destinations with stream keys redacted */
      destinations: string[]
    }
  | {
      success: false
      error: string
    }

export type StopStreamParams = {
  sessionId?: string
}

export type StopStreamResult =
  | {
      success: true
      tabId: number
      /** Stream duration in ms */
      duration: number
      /** Total bytes received from the extension and piped to ffmpeg */
      bytesReceived: number
    }
  | {
      success: false
      error: string
    }

export type StreamStats = {
  chunksReceived: number
  bytesReceived: number
  /** Encoder output fps parsed from ffmpeg progress lines */
  ffmpegFps?: number
  /** Encoder output bitrate in kbps parsed from ffmpeg progress lines */
  ffmpegBitrateKbps?: number
  /** Dropped frames parsed from ffmpeg progress lines */
  droppedFrames?: number
  lastFfmpegLine?: string
}

export type StreamStatusResult = {
  streaming: boolean
  tabId?: number
  startedAt?: number
  /** Destinations with stream keys redacted */
  destinations?: string[]
  stats?: StreamStats
  /** Error from the last stream that died unexpectedly (ffmpeg crash, RTMP failure) */
  error?: string
}

// Ghost Browser API command message (for Ghost Browser integration)
export type GhostBrowserCommandMessage = {
  id: number
  method: 'ghost-browser'
  params: {
    /** API namespace: 'ghostPublicAPI' | 'ghostProxies' | 'projects' */
    namespace: 'ghostPublicAPI' | 'ghostProxies' | 'projects'
    /** Method name within the namespace */
    method: string
    /** Arguments to pass to the method */
    args: unknown[]
  }
}

export type GhostBrowserCommandResult =
  | {
      success: true
      result: unknown
    }
  | {
      success: false
      error: string
    }
