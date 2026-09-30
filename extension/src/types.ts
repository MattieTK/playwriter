export type ConnectionState = 'idle' | 'connected' | 'extension-replaced'
export type TabState = 'connecting' | 'connected' | 'error'

export interface TabInfo {
  sessionId?: string
  targetId?: string
  state: TabState
  errorText?: string
  attachOrder?: number
  isRecording?: boolean
  /** Tab group title this tab belongs to. Undefined = default 'playwriter' group.
   *  Source of truth for grouping — Chrome group membership is derived from it. */
  groupTitle?: string
  /** Opaque session ownership key for tabs created via Target.createTarget/createInitialTab.
   *  Group titles are not identities: the key scopes updateTabGroup renames so a
   *  default-group rename never steals manually toggled or other sessions' tabs. */
  groupKey?: string
  /** Explicit group color chosen with --tab-group-color. Any tab with an explicit
   *  color wins over the title-hash color for its whole group. */
  groupColor?: chrome.tabGroups.ColorEnum
}

export interface ExtensionState {
  tabs: Map<number, TabInfo>
  connectionState: ConnectionState
  currentTabId: number | undefined
  preferredWindowId: number | undefined
  errorText: string | undefined
}

/**
 * Recording state - stored in service worker to track active recordings.
 * The actual MediaRecorder/MediaStream live in the offscreen document.
 */
export interface RecordingInfo {
  tabId: number
  startedAt: number
}
