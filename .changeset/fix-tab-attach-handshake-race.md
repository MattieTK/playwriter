---
'playwriter': patch
---

Fix enabling a tab while the extension reconnects to the relay. The reconnect handshake attached the tab, then the click attached it a second time and failed with `Another debugger is already attached`. The tab stayed in an error state and the relay kept a dead target, so later commands such as `recorder start` failed with `No tab found`.
