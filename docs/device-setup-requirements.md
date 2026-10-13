# Device setup requirements

The native route needs Apple Silicon macOS with VideoToolbox, Node 24+, pinned Python runtimes and native dependencies, a trusted physical iPad on iPadOS 27 or later, Developer Mode and applicable Apple device support data. See [Setup](../skills/glassport/references/setup.md) for the actual commands and private configuration format.

Use existing trust and configuration where available. Pairing, unlocking, passcode entry, device-setting changes and restarts require the user's own action or appropriate approval. The default native route does not use a signed WebDriverAgent runner or require Xcode agreement prompts.

For a configured Tailscale native route, verify the intended paired identity and actual RemotePairing endpoint. Network reachability alone does not prove display, input or text transfer. A configured network failure never silently switches to USB. Verify a current picture and a harmless visible response in the actual browser before entering app content.

Fresh installation on another Mac or iPad and distinct-network operation are not certified by the reference-device observations in [Verification](VERIFICATION.md).
