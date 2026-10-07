# Playwriter MCP

Control your Chrome browser via Model Context Protocol (MCP) using Chrome DevTools Protocol (CDP) events.

[**Install from Chrome Web Store**](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe)

## What is Playwriter MCP?

Playwriter MCP is a Chrome extension that enables Playwright to connect to your existing Chrome instance without spawning a new browser or requiring Chrome to be started in CDP mode. This allows AI assistants and automation tools to interact with your browser seamlessly through the Model Context Protocol.

## Key Features

- **No new Chrome instances**: Works with your current browser session
- **No CDP mode required**: No need to restart Chrome with special flags
- **MCP integration**: Exposes browser control through the Model Context Protocol
- **CDP events**: Full access to Chrome DevTools Protocol capabilities
- **Playwright compatible**: Connect Playwright directly to your running Chrome
- **Remote control**: Share your browser (every Playwriter tab, plus new tabs) through a temporary, revocable link after an explicit confirmation

## How it Works

1. Install the extension in your Chrome browser
2. Click the extension icon to attach the debugger to the current tab
3. The extension creates a relay connection using CDP
4. Connect your MCP client (like Playwright) to control the browser
5. The icon changes color to indicate connection status:
   - Gray: Not connected
   - Green: Successfully connected

## Use Cases

- Browser automation without disrupting your workflow
- AI-assisted web browsing and testing
- Debugging and development with MCP-enabled tools
- Remote browser control for various applications

## Permissions

This extension uses these permissions for its browser automation purpose:

- **debugger**: Control tabs selected by the user through Chrome DevTools Protocol
- **scripting**: Show the isolated Playwriter toolbar on connected tabs
- **tabGroups and contextMenus**: Organize connected tabs and support Pin element
- **tabCapture, offscreen, and clipboardWrite**: Record selected tabs and copy prompts after user actions
- **storage**: Keep a local installation ID and active Remote control session state
- **identity and identity.email**: Distinguish Chrome profiles connected to the same local relay; these values are not sent through Remote control
- **webNavigation**: Track navigation and popups opened by connected tabs
- **host permissions**: Attach the debugger on any site the user chooses to automate

## Getting Started

1. [Install the extension from the Chrome Web Store](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe)
2. Navigate to any webpage
3. Click the Playwriter MCP extension icon
4. The debugger will attach and the icon will turn green when connected
5. Connect your MCP client to start controlling the browser

## Privacy & Security

Playwriter MCP is **local by default**. Normal browser control travels between the extension and the relay on your computer.

The optional **Remote control** feature sends browser data through an encrypted `playwriter.dev` tunnel only after you click the toolbar button and accept a disclosure. This can include screenshots, page content, URLs, input events, network data, cookies, and browser storage. Tunnel payloads are relayed in memory and are not stored by Playwriter.

Remote control is **not a security sandbox**. Anyone holding the secret link receives broad browser automation access until you revoke it. Share the link only with a person or agent you fully trust.

Read the [privacy policy](https://playwriter.dev/privacy) and [security documentation](https://playwriter.dev/docs/security) before sharing sensitive tabs.

## Support

For issues, feature requests, or contributions, visit the [GitHub repository](https://github.com/remorses/playwriter).

## License

Apache-2.0
