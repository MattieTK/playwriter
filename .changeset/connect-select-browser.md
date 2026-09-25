---
'playwriter': minor
---

Pick which browser `connectViaExtension()` controls when the extension runs in more than one browser or profile. Pass `selectBrowser`: it gets every connected browser and returns the one to use.

```ts
import { connectViaExtension, listBrowsers } from 'playwriter'

await using connection = await connectViaExtension({
  selectBrowser: (browsers) => {
    // [{ id, browser: 'Brave', email: 'me@work.com', activeTabs, playwriterVersion }]
    return browsers.find((b) => b.browser === 'Brave' && b.email === 'me@work.com')
  },
})
console.log(connection.extensionBrowser.id)

// same list, without connecting
const browsers = await listBrowsers()
```

`id` is stable across restarts, so you can save it and match on it later. Without `selectBrowser`, `connectViaExtension()` now fails with a list of connected browsers when more than one is connected, instead of a vague relay error.
