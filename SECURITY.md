# Security Policy

## Remote control gives browser-wide access

Remote control shares your **browser** through a secret id. The recipient gets
the same access as a local Playwriter agent:

- every tab where Playwriter is enabled
- new tabs it opens (in the background, in its tab group)
- anything those tabs can reach, including other sites and extension pages

It is not a sandbox. A short denylist only blocks whole-profile cookie APIs
(`Network.getAllCookies`, `Network.clearBrowserCookies`, `Storage.*Cookies`) and
`Network.clearBrowserCache`, so an agent cannot nuke every login by accident.
It does not make a malicious recipient safe.

Share the id only with a person or agent you fully trust. **Stop sharing** (from
any Playwriter tab), closing or disconnecting the tab where sharing started, or
cancelling Chrome's debugging banner closes the tunnel immediately. Tabs the
remote opened are then detached and left open.

## Reporting

Open a private security advisory at
https://github.com/remorses/playwriter/security/advisories/new
