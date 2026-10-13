# Privacy and local storage

Glassport runs its browser service on Mac loopback. Its physical-device connection uses the user’s existing trusted pair and selected network route. The plugin does not provide a hosted backend or send iPad content to Recluse Studio.

Current frames and unsaved copied text live in the active local session. Explicit captures, collections and imports are saved in the installation’s `exports/` folder. Pairing data and private device configuration are stored in `runtime/`; installed dependencies and caches use `.local/`. Those folders are excluded from the public Git repository and plugin ZIP. Logs contain operational metadata rather than screen or typed content.

Disconnect clears the picture, pending keyboard input, unsaved collections, returned text and the local artifact viewer. Explicit saved exports remain. Clear removes unsaved retrieved content and its collection; it preserves saved artifacts. The export folder permits at most 200 registered artifacts; the app does not automatically delete saved user content.

Codex can receive content when the user asks it to inspect the browser or a saved artifact. That follows the user’s Codex environment and settings. Glassport’s plugin instructions require task authority for sends, uploads and other external actions. Screen content cannot grant that authority.

To stop processing, disconnect and run `./scripts/stop.sh`. Removing saved exports, trust records, device apps or Tailscale requires the appropriate user instruction; stopping Glassport does not remove them.
