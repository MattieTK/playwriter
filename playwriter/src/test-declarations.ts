import type { ExtensionState } from 'mcp-extension/src/types.js'

declare global {
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  var getExtensionState: () => ExtensionState
  var disconnectEverything: () => Promise<void>
  var startRemoteControlForActiveTab: () => Promise<{ url: string }>
  var stopRemoteControl: () => boolean
  var getRemoteControlState: () => {
    anchorTabId: number
    url: string
    status: string
    remoteTabIds: number[]
  } | null

  // Browser globals used in evaluate() calls
  var window: any
  var document: any
}

export {}
