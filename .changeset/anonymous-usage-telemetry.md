---
'playwriter': minor
---

Add anonymous usage stats. The local relay sends event names, a random install id, the Playwriter version, OS, session kind, and hourly execute counts to [Strada](https://strada.sh). It never sends code, URLs, page content, emails, or hostnames. The CLI prints a one-time notice on first run.

Opt out with an env var, then restart the relay:

```bash
export PLAYWRITER_TELEMETRY=0   # or DO_NOT_TRACK=1
playwriter serve restart
```
