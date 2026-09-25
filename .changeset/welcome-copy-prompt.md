---
'playwriter': patch
---

Refresh the extension welcome and tutorial pages. The welcome page now leads with a short blurb and a "Copy agent prompt to install" button. Clicking it copies a prompt that tells your coding agent (Claude Code, opencode, pi, etc.) to install the Playwriter skill via `npx -y skills add https://playwriter.dev` and open the GitHub project to confirm it works. The detailed installation steps, CLI examples, icon states, privacy notes, and MCP setup now live under a collapsible "Manual setup & full documentation" section, with colored accents on key words. The tutorial page (shown before the daemon starts) is shortened with a green highlight on the "green" icon cue.
