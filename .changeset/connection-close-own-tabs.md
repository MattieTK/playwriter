---
'playwriter': patch
---

`connection.close()` from `connectViaExtension()` now closes only the tabs that connection opened, plus popups they opened. Before, it closed every Playwriter tab it could see, so two SDK scripts running at the same time, or an SDK script next to a CLI session, closed each other's tabs.

The extension closes the tabs, using the session ownership it already tracks for tab groups. With an older extension, `close()` leaves the tabs open and logs a warning. Update the extension to get the cleanup.

`deleteRelaySession({ sessionId, closeCreatedTabs: true })` exposes the same cleanup for custom clients and returns `{ warning }`.

Popups opened from a session's tab (`window.open`, `target=_blank`) now also belong to that session, so `session update --tab-group` moves them together with the session's tabs.
