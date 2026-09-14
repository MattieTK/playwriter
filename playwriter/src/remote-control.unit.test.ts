import { describe, test, expect } from 'vitest'
import {
  buildRemoteHelloMessage,
  buildRemoteControlPrompt,
  buildRemoteTabNotSharedError,
  buildRemoteControlUrl,
  buildRemoteUpstreamWsUrl,
  buildTunnelOrigin,
  decodeExtensionCdpMessage,
  encodeExtensionCdpCommand,
  extractViewerTunnelId,
  readAttachedTargetSession,
  generateTunnelId,
  getRemoteCdpCommandRejection,
  getRemoteDialRetryMs,
  getRemoteExtensionMethodRejection,
  parseRemoteControlUrl,
  REMOTE_EXTENSION_NOT_CONNECTED_ERROR,
  shouldDropRemoteTunnelFrame,
  TRAFORO_TUNNEL_OFFLINE_CLOSE_CODE,
} from './remote-control.js'

describe('remote-control', () => {
  test('drops only screencast frames when the tunnel buffer is full', () => {
    expect(
      [
        shouldDropRemoteTunnelFrame({ bufferedAmount: 2 * 1024 * 1024, isScreencastFrame: true }),
        shouldDropRemoteTunnelFrame({ bufferedAmount: 2 * 1024 * 1024, isScreencastFrame: false }),
        shouldDropRemoteTunnelFrame({ bufferedAmount: 0, isScreencastFrame: true }),
      ],
    ).toEqual([true, false, false])
  })

  test('tunnel ids are unguessable and accepted by the Playwriter worker', () => {
    const id = generateTunnelId()
    expect(generateTunnelId()).not.toBe(id)
    // Must match the id charset and length the Playwriter worker accepts.
    expect(id).toMatch(/^[a-z0-9-]{1,63}$/)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  test('the shared link points at the viewer page and hides the id in the hash', () => {
    const url = buildRemoteControlUrl({ tunnelId: 'abc123' })
    expect(url).toMatchInlineSnapshot(`"https://playwriter.dev/remote-control#abc123"`)
    // The initial viewer request omits the hash; JS later uses it as the tunnel host.
    expect(new URL(url).pathname).toMatchInlineSnapshot(`"/remote-control"`)
    expect(extractViewerTunnelId(url)).toMatchInlineSnapshot(`"abc123"`)
  })

  test('resolves a viewer link to the tunnel websocket', () => {
    expect(parseRemoteControlUrl('abc123')).toMatchInlineSnapshot(`
      {
        "host": "abc123-tunnel.playwriter.dev",
        "httpUrl": "https://abc123-tunnel.playwriter.dev",
        "wsUrl": "wss://abc123-tunnel.playwriter.dev/extension",
      }
    `)
    expect(parseRemoteControlUrl(buildRemoteControlUrl({ tunnelId: 'abc123' }))).toMatchInlineSnapshot(`
      {
        "host": "abc123-tunnel.playwriter.dev",
        "httpUrl": "https://abc123-tunnel.playwriter.dev",
        "wsUrl": "wss://abc123-tunnel.playwriter.dev/extension",
      }
    `)
    expect(buildRemoteUpstreamWsUrl({ tunnelId: 'abc123' })).toMatchInlineSnapshot(`"wss://abc123-tunnel.playwriter.dev/traforo-upstream?_tunnelId=abc123"`)
    expect(buildTunnelOrigin({ tunnelId: 'abc123' })).toMatchInlineSnapshot(`"https://abc123-tunnel.playwriter.dev"`)
  })

  // Remote-control hosts moved to playwriter.dev, but links minted by an older
  // extension must keep working, and self-hosted tunnel domains must stay usable.
  test('still accepts a tunnel host verbatim, including older and self-hosted domains', () => {
    expect(parseRemoteControlUrl('https://abc123-tunnel.traforo.dev')).toMatchInlineSnapshot(`
      {
        "host": "abc123-tunnel.traforo.dev",
        "httpUrl": "https://abc123-tunnel.traforo.dev",
        "wsUrl": "wss://abc123-tunnel.traforo.dev/extension",
      }
    `)
    // wss:// and trailing paths normalize to the same dial target
    expect(parseRemoteControlUrl('wss://abc123-tunnel.traforo.dev/whatever').wsUrl).toBe(
      'wss://abc123-tunnel.traforo.dev/extension',
    )
    // a custom domain keeps its host instead of being rebuilt from the id
    expect(parseRemoteControlUrl('https://abc123-tunnel.mycompany.com').wsUrl).toBe(
      'wss://abc123-tunnel.mycompany.com/extension',
    )
  })

  test('explains the unquoted-shell case when the hash is missing', () => {
    expect(() =>
      parseRemoteControlUrl('https://playwriter.dev/remote-control'),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Remote control id is missing. Pass the id from the copied prompt, for example:
        playwriter session new --remote your-id]
    `)
    expect(extractViewerTunnelId('https://playwriter.dev/remote-control#BAD_ID')).toBe(null)
    expect(extractViewerTunnelId('https://playwriter.dev/other#abc123')).toBe(null)
  })

  test('rejects malformed urls', () => {
    expect(() => parseRemoteControlUrl('ftp://nope')).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid remote control URL protocol: ftp: (expected https:// or wss://)]`,
    )
    expect(() => parseRemoteControlUrl('not a url')).toThrowErrorMatchingInlineSnapshot(`[Error: Invalid remote control id: not a url]`)
  })
  test('cdp command guards', () => {
    expect(getRemoteCdpCommandRejection('Page.navigate')).toBeNull()
    expect(getRemoteCdpCommandRejection('Runtime.evaluate')).toBeNull()
    expect(getRemoteCdpCommandRejection('Target.createTarget')).toMatchInlineSnapshot(
      `"This is a shared remote-control browser tab. You cannot create additional tabs and should not try to. The user shared exactly one tab with you (plus any popups that tab opens itself). Keep working inside the shared tab: navigate it with page.goto() instead of opening new pages. If you really need another tab, ask the user to open one and share it with you (they get a separate id per shared tab)."`,
    )
    expect(getRemoteCdpCommandRejection('Network.clearBrowserCookies')).toMatchInlineSnapshot(
      `"Network.clearBrowserCookies is not allowed on a shared remote-control tab: it clears cookies for EVERY site in the user profile."`,
    )
    expect(getRemoteCdpCommandRejection('Network.clearBrowserCache')).toBeTruthy()
  })

  test('blocks obvious profile-wide cookie operations', () => {
    const methods = ['Network.getAllCookies', 'Storage.clearCookies', 'Storage.getCookies', 'Storage.setCookies']
    expect(
      methods.map((method) => {
        return { method, rejection: getRemoteCdpCommandRejection(method) }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "method": "Network.getAllCookies",
          "rejection": "Network.getAllCookies is not allowed on a shared remote-control tab: it reads cookies for EVERY site in the user profile.",
        },
        {
          "method": "Storage.clearCookies",
          "rejection": "Storage.clearCookies is not allowed on a shared remote-control tab: it clears cookies for EVERY site in the user profile.",
        },
        {
          "method": "Storage.getCookies",
          "rejection": "Storage.getCookies is not allowed on a shared remote-control tab: it reads cookies for EVERY site in the user profile.",
        },
        {
          "method": "Storage.setCookies",
          "rejection": "Storage.setCookies is not allowed on a shared remote-control tab: it changes cookies outside the shared tab.",
        },
      ]
    `)
  })

  test('allows cookie operations targeted by URL or domain', () => {
    const methods = ['Network.deleteCookies', 'Network.getCookies', 'Network.setCookie', 'Network.setCookies']
    expect(
      methods.map((method) => {
        return getRemoteCdpCommandRejection(method)
      }),
    ).toEqual([null, null, null, null])
  })

  test('extension method guards', () => {
    expect(getRemoteExtensionMethodRejection('forwardCDPCommand')).toBeNull()
    expect(getRemoteExtensionMethodRejection('updateTabGroup')).toBeNull()
    expect(getRemoteExtensionMethodRejection('createInitialTab')).toContain('shared remote-control browser tab')
    expect(getRemoteExtensionMethodRejection('startRecording')).toMatchInlineSnapshot(
      `"Screen recording is not supported on shared remote-control tabs yet."`,
    )
    expect(getRemoteExtensionMethodRejection('ghost-browser')).toMatchInlineSnapshot(
      `"Ghost Browser APIs are not available on shared remote-control tabs."`,
    )
  })

  test('tab not shared error mentions the method', () => {
    expect(
      buildRemoteTabNotSharedError({ method: 'Page.navigate', sessionId: 'pw-tab-x-2' }),
    ).toMatchInlineSnapshot(
      `"Cannot run Page.navigate (sessionId: pw-tab-x-2): that tab is not shared over this remote-control link. You only have access to the tab the user shared (and popups it opened). Ask the user to share the other tab if you need it."`,
    )
  })

  test('retries the public dial sooner after offline close 4008 than after a drop', () => {
    expect(
      [
        getRemoteDialRetryMs(TRAFORO_TUNNEL_OFFLINE_CLOSE_CODE),
        getRemoteDialRetryMs(1006),
        getRemoteDialRetryMs(1012),
      ],
    ).toMatchInlineSnapshot(`
      [
        500,
        4000,
        4000,
      ]
    `)
    expect(getRemoteDialRetryMs(1006)).toBeGreaterThan(3000)
    expect(REMOTE_EXTENSION_NOT_CONNECTED_ERROR).toMatchInlineSnapshot(`"Could not reach the shared remote-control tab. The tunnel dropped. Ask the user to confirm Remote control is still on, then retry. If they clicked Stop sharing, they need to share a fresh id."`)
    expect(REMOTE_EXTENSION_NOT_CONNECTED_ERROR).not.toContain('chromewebstore')
  })

  test('prompt contains the id and the warning', () => {
    const prompt = buildRemoteControlPrompt({ id: 'abc123' })
    expect(prompt).toMatchInlineSnapshot(`
      "Connect to my shared Chrome tab:

      npx -y playwriter@latest session new --remote abc123

      Then use the printed session id. Read https://playwriter.dev/SKILL.md. NEVER share this id."
    `)
  })

  test('wraps cdp commands for the extension protocol', () => {
    expect(
      encodeExtensionCdpCommand({ id: 3, method: 'Page.enable', sessionId: 'pw-tab-1-2' }),
    ).toMatchInlineSnapshot(`"{"id":3,"method":"forwardCDPCommand","params":{"method":"Page.enable","sessionId":"pw-tab-1-2","params":{}}}"`)
  })

  test('decodes every message shape the tunnel sends', () => {
    expect(decodeExtensionCdpMessage('{"id":3,"result":{"ok":true}}')).toMatchInlineSnapshot(`
      {
        "error": undefined,
        "id": 3,
        "kind": "response",
        "result": {
          "ok": true,
        },
      }
    `)
    expect(decodeExtensionCdpMessage('{"id":3,"error":"boom"}')).toMatchInlineSnapshot(`
      {
        "error": "boom",
        "id": 3,
        "kind": "response",
        "result": undefined,
      }
    `)
    expect(
      decodeExtensionCdpMessage(
        '{"method":"forwardCDPEvent","params":{"method":"Page.screencastFrame","sessionId":"pw-tab-1-2","params":{"data":"x"}}}',
      ),
    ).toMatchInlineSnapshot(`
      {
        "kind": "event",
        "method": "Page.screencastFrame",
        "params": {
          "data": "x",
        },
        "sessionId": "pw-tab-1-2",
      }
    `)
    expect(decodeExtensionCdpMessage('{"method":"hello","params":{"browser":"chrome"}}')).toMatchInlineSnapshot(`
      {
        "browser": "chrome",
        "kind": "hello",
        "version": undefined,
      }
    `)
    expect(decodeExtensionCdpMessage('not json')).toMatchInlineSnapshot(`
      {
        "kind": "ignored",
      }
    `)
  })

  test('finds the shared tab session in the pushed attach event', () => {
    const attached = decodeExtensionCdpMessage(
      '{"method":"forwardCDPEvent","params":{"method":"Target.attachedToTarget","params":{"sessionId":"pw-tab-7-1","targetInfo":{"url":"https://example.com","type":"page"}}}}',
    )
    expect(readAttachedTargetSession(attached)).toMatchInlineSnapshot(`
      {
        "sessionId": "pw-tab-7-1",
        "url": "https://example.com",
      }
    `)
    expect(readAttachedTargetSession(decodeExtensionCdpMessage('{"method":"hello","params":{}}'))).toBe(null)
  })

  test('remote hello excludes browser identity', () => {
    expect(buildRemoteHelloMessage({ browser: 'chrome', version: '1.2.3' })).toMatchInlineSnapshot(`
      {
        "method": "hello",
        "params": {
          "browser": "chrome",
          "remote": true,
          "version": "1.2.3",
        },
      }
    `)
  })
})
