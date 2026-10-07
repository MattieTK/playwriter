import { describe, expect, test } from 'vitest'
import {
  EXTENSION_INVENTORY_FAILED_CLOSE,
  EXTENSION_INVENTORY_TIMEOUT_CLOSE,
  colorForTabGroupTitle,
  computeTabGroupSyncPlan,
  isBrowserAllowedWebSocketCloseCode,
  normalizeTabGroupColor,
  normalizeTabGroupTitle,
  shouldDisconnectAfterTabGroupChange,
  shouldUpdateTabGroupForTab,
} from './protocol.js'
import { namespaceRemoteTabGroupKey } from './remote-control.js'

describe('browser websocket close codes', () => {
  test('allows 1000 and 3000-4999 only', () => {
    expect([
      isBrowserAllowedWebSocketCloseCode(1000),
      isBrowserAllowedWebSocketCloseCode(1011),
      isBrowserAllowedWebSocketCloseCode(4005),
      isBrowserAllowedWebSocketCloseCode(2999),
      isBrowserAllowedWebSocketCloseCode(5000),
    ]).toEqual([true, false, true, false, false])
  })

  test('inventory close codes are browser-safe', () => {
    expect(isBrowserAllowedWebSocketCloseCode(EXTENSION_INVENTORY_TIMEOUT_CLOSE)).toBe(true)
    expect(isBrowserAllowedWebSocketCloseCode(EXTENSION_INVENTORY_FAILED_CLOSE)).toBe(true)
  })
})

describe('shouldDisconnectAfterTabGroupChange', () => {
  test('ignores stale ungroup after reconnect regrouped the tab', () => {
    expect(
      shouldDisconnectAfterTabGroupChange({
        currentGroupId: 2019741149,
        managedGroupIds: [2019741149],
        tabState: 'connected',
      }),
    ).toBe(false)
  })

  test('ignores connecting tabs', () => {
    expect(
      shouldDisconnectAfterTabGroupChange({
        currentGroupId: -1,
        managedGroupIds: [2019741149],
        tabState: 'connecting',
      }),
    ).toBe(false)
  })

  test('disconnects a connected tab that left all managed groups', () => {
    expect(
      shouldDisconnectAfterTabGroupChange({
        currentGroupId: -1,
        managedGroupIds: [2019741149],
        tabState: 'connected',
      }),
    ).toBe(true)
  })

  test('does not disconnect when moved into another managed group', () => {
    expect(
      shouldDisconnectAfterTabGroupChange({
        currentGroupId: 555,
        managedGroupIds: [2019741149, 555],
        tabState: 'connected',
      }),
    ).toBe(false)
  })

  test('does not disconnect when there are no managed groups', () => {
    expect(
      shouldDisconnectAfterTabGroupChange({
        currentGroupId: -1,
        managedGroupIds: [],
        tabState: 'connected',
      }),
    ).toBe(false)
  })
})

describe('normalizeTabGroupTitle', () => {
  test('trims, rejects empty, caps length, strips control characters', () => {
    expect([
      normalizeTabGroupTitle('  agent 2  '),
      normalizeTabGroupTitle('   '),
      normalizeTabGroupTitle(undefined),
      normalizeTabGroupTitle(42),
      normalizeTabGroupTitle('x'.repeat(200))?.length,
      normalizeTabGroupTitle('log\nforge\r[evil]'),
      normalizeTabGroupTitle('\u0000\u0007'),
    ]).toEqual(['agent 2', null, null, null, 80, 'log forge [evil]', null])
  })
})

describe('normalizeTabGroupColor', () => {
  test('accepts chrome colors case-insensitively, rejects everything else', () => {
    expect([
      normalizeTabGroupColor('blue'),
      normalizeTabGroupColor(' Orange '),
      normalizeTabGroupColor('GREEN'),
      normalizeTabGroupColor('magenta'),
      normalizeTabGroupColor(''),
      normalizeTabGroupColor(undefined),
      normalizeTabGroupColor(null),
      normalizeTabGroupColor(123),
    ]).toEqual(['blue', 'orange', 'green', null, null, null, null, null])
  })
})

describe('shouldUpdateTabGroupForTab', () => {
  test('default-group and remote updates stay session-owned, custom local renames move the group', () => {
    expect([
      shouldUpdateTabGroupForTab({ currentTitle: 'playwriter', currentKey: '1', from: 'playwriter', key: '1' }),
      shouldUpdateTabGroupForTab({ currentTitle: 'playwriter', currentKey: '2', from: 'playwriter', key: '1' }),
      shouldUpdateTabGroupForTab({
        currentTitle: 'playwriter',
        currentKey: '1',
        from: 'playwriter',
        key: namespaceRemoteTabGroupKey('1'),
      }),
      shouldUpdateTabGroupForTab({ currentTitle: 'research', from: 'research' }),
      // remote renames of a custom group move only the remote session's own tabs
      shouldUpdateTabGroupForTab({ currentTitle: 'research', currentKey: '1', from: 'research', key: 'remote:1', ownedOnly: true }),
      shouldUpdateTabGroupForTab({ currentTitle: 'research', currentKey: 'remote:1', from: 'research', key: 'remote:1', ownedOnly: true }),
    ]).toEqual([true, false, false, true, false, true])
  })
})

describe('colorForTabGroupTitle', () => {
  test('default stays green, custom titles are deterministic and never green', () => {
    expect(colorForTabGroupTitle('playwriter')).toBe('green')
    expect(colorForTabGroupTitle('agent-2')).toBe(colorForTabGroupTitle('agent-2'))
    expect(colorForTabGroupTitle('agent-2')).not.toBe('green')
  })
})

describe('computeTabGroupSyncPlan', () => {
  test('creates a new group per title when none exist', () => {
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [
          { tabId: 1, title: 'playwriter' },
          { tabId: 2, title: 'agent-2' },
          { tabId: 3, title: 'agent-2' },
        ],
        groups: [],
        ownedTabIds: [1, 2, 3],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [
          {
            "tabIds": [
              1,
            ],
            "title": "playwriter",
          },
          {
            "tabIds": [
              2,
              3,
            ],
            "title": "agent-2",
          },
        ],
        "ungroupTabIds": [],
        "updateOps": [],
      }
    `)
  })

  test('adds missing tabs to existing groups and ungroups leftovers', () => {
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [
          { tabId: 1, title: 'playwriter' },
          { tabId: 2, title: 'playwriter' },
        ],
        groups: [{ groupId: 10, title: 'playwriter', tabIds: [1, 99] }],
        ownedTabIds: [1, 2, 99],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [
          {
            "groupId": 10,
            "tabIds": [
              2,
            ],
            "title": "playwriter",
          },
        ],
        "ungroupTabIds": [
          99,
        ],
        "updateOps": [],
      }
    `)
  })

  test('never ungroups user tabs in a group with a colliding title', () => {
    // User has their own group named 'research' with tabs 50/51; a session
    // with --tab-group research adds tab 1. The user tabs must stay put.
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [{ tabId: 1, title: 'research' }],
        groups: [{ groupId: 30, title: 'research', tabIds: [50, 51] }],
        ownedTabIds: [1],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [
          {
            "groupId": 30,
            "tabIds": [
              1,
            ],
            "title": "research",
          },
        ],
        "ungroupTabIds": [],
        "updateOps": [],
      }
    `)
  })

  test('moves a tab between managed groups without an intermediate ungroup', () => {
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [{ tabId: 1, title: 'agent-2' }],
        groups: [
          { groupId: 10, title: 'playwriter', tabIds: [1] },
          { groupId: 20, title: 'agent-2', tabIds: [] },
        ],
        ownedTabIds: [1],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [
          {
            "groupId": 20,
            "tabIds": [
              1,
            ],
            "title": "agent-2",
          },
        ],
        "ungroupTabIds": [],
        "updateOps": [],
      }
    `)
  })

  test('drains duplicate groups with the same title into the keeper', () => {
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [
          { tabId: 1, title: 'playwriter' },
          { tabId: 2, title: 'playwriter' },
        ],
        groups: [
          { groupId: 10, title: 'playwriter', tabIds: [1] },
          { groupId: 11, title: 'playwriter', tabIds: [2, 3] },
        ],
        ownedTabIds: [1, 2, 3],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [
          {
            "groupId": 10,
            "tabIds": [
              2,
            ],
            "title": "playwriter",
          },
        ],
        "ungroupTabIds": [
          3,
        ],
        "updateOps": [],
      }
    `)
  })

  test('cleans up groups whose tabs all disconnected', () => {
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [],
        groups: [{ groupId: 20, title: 'agent-2', tabIds: [4, 5] }],
        ownedTabIds: [4, 5],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [],
        "ungroupTabIds": [
          4,
          5,
        ],
        "updateOps": [],
      }
    `)
  })

  test('refreshes title on in-sync groups so Chrome resets are corrected', () => {
    expect(
      computeTabGroupSyncPlan({
        desiredTabs: [{ tabId: 1, title: 'playwriter' }],
        groups: [{ groupId: 10, title: 'playwriter', tabIds: [1] }],
        ownedTabIds: [1],
      }),
    ).toMatchInlineSnapshot(`
      {
        "groupOps": [],
        "ungroupTabIds": [],
        "updateOps": [
          {
            "groupId": 10,
            "title": "playwriter",
          },
        ],
      }
    `)
  })
})
