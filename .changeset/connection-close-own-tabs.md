---
'playwriter': patch
---

`connection.close()` from `connectViaExtension()` now closes only the tabs that connection opened (and popups they opened). Before, it closed every Playwriter tab it could see, so two SDK scripts running at the same time, or an SDK script next to a CLI session, closed each other's tabs.

`deleteRelaySession({ sessionId, closeCreatedTabs: true })` exposes the same cleanup for custom clients.
