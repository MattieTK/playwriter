---
'playwriter': patch
---

Show one clear error when the Chrome extension is not connected. `playwriter session new`, `playwriter -e` and the `connectViaExtension()` Node API now all print the same message, written so an agent can pass it to the user:

```
The Playwriter Chrome extension is not connected.
Tell the user to:
1. Install the Playwriter extension in Chrome: https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe
2. Keep Chrome open. If the extension icon is gray, click it on any tab.
3. Run the command again.
```

Skills that use Playwriter as a library get this message with no extra code. The text and the install URL are exported as `EXTENSION_NOT_CONNECTED_ERROR` and `PLAYWRITER_EXTENSION_URL`.
