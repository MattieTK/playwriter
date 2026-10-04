---
'playwriter': patch
'@xmorse/playwright-core': patch
---

Fix agent clicks failing with `<div data-playwriter-toolbar> intercepts pointer events` when the target sits under the in-page toolbar.

Before each actionability hit-target check, `@xmorse/playwright-core` sets `data-playwriter-agent` on the toolbar host. The toolbar goes click-through while the attribute is set, so `locator.click()`, `hover()`, `tap()` and `dragTo()` reach the page element under it. The attribute is removed 1 second later, so the user can click the toolbar again.

The toolbar buttons are also no longer focusable, so agent `Tab`, `Enter`, or `Space` key presses can never trigger them.

Fixes #126
