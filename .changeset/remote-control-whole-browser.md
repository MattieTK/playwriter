---
'playwriter': minor
---

Remote control now shares the browser, not one tab. A remote agent connected with `playwriter session new --remote <id>` gets the same access as a local agent:

- sees and drives every tab where Playwriter is enabled
- opens new tabs with `context.newPage()`; they open in the background, in the session's `remote` tab group
- `context.pages()[0]` is still the tab where the user started sharing

```bash
playwriter session new --remote <id>
playwriter -s 1 -e "state.page = await context.newPage(); await state.page.goto('https://example.com')"
```

Whole-profile cookie APIs (`Network.getAllCookies`, `Network.clearBrowserCookies`, `Storage.*Cookies`) and `Network.clearBrowserCache` stay blocked, so an agent cannot wipe every login by accident. Remote control is still not a sandbox: share the id only with agents you fully trust.

**Stop sharing** now works from the Remote ON dropdown of any Playwriter tab and closes the tunnel immediately. Tabs the remote agent opened are detached and left open. Sharing also ends when the tab where it started is closed or disconnected.

Remote sessions only regroup or rename tabs they opened. A remote session `1` never touches the tabs or groups of local session `1`.
