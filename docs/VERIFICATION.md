# Verification scope

Glassport is a local preview. The earlier physical campaign exercised one trusted iPad with iPadOS 27.0.1 on Apple Silicon macOS, using the native route through Codex's internal browser. Those observations support the features below, without establishing fresh-installation compatibility for other devices.

| Earlier physical observation | Scope |
| --- | --- |
| Live display and pointer input with USB removed | Configured paired Tailscale route on the tested local network. |
| 30 correct ordinary taps | Current portrait renderer; measured feedback upper bounds of 1199 ms median and 1384 ms at the 95th percentile. |
| 30 exact text round trips totaling 3,463 code points | Synthetic Unicode and multiline text through public native clipboard formats. |
| Existing text retrieval and unsent app input | Observed Teams and Copilot views; an Outlook synthetic round trip also passed. Accounts and policies are not part of the public proof. |
| A 166-byte iPad-created export | Native import, saved bytes and browser-downloaded bytes matched. |
| Ordered copied collection and saved capture | Retained order and exact saved-artifact retrieval after restart. |
| MCP display and native input | Real stdio tools delegated to the existing browser-owned native session. |

Detailed source receipts and screenshots are retained privately. The public repository contains a generalized summary rather than private device or app evidence. These observations were made before the documentation cleanup and packaging release; they are not a newly executed physical campaign.

Automated checks cover input bounds, stale observations, command deduplication and serialization, frame parsing, artifact hashes and limits, clipboard-format contracts, MCP credential scope, and actual loopback Host/Origin/CSRF rejection. The MCP protocol verifier uses a real SDK stdio handshake and synthetic local saved bytes. It makes no physical-device claim.

Full orientation transitions, distinct-network routing, all reconnect/fault cases, the complete five-start timing series, audio and broad device compatibility remain unverified. The earlier mixed session and reconnect observations do not close every fault or queue case. Clipboard results do not identify a native foreground app, and private app storage is not a supported import route.

Native discovery uses pinned appium-ios-device directly rather than importing through the legacy XCUITest driver. The default dependency tree excludes that driver's bundled vulnerable copy. A shell-quote 1.12.0 override addresses [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), and regression checks exercise the advisory input against the installed root and discovery dependency resolution. The legacy Appium adapter requires its separately installed driver and is not part of native acceptance.
