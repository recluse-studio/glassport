# Personal plugin and MCP tools

Glassport packages the local application source, a standalone stdio MCP executable and a workflow skill. The installed MCP executable needs Node 24+ but does not need its own node_modules directory. The application runs in a separate persistent writable workspace with its native prerequisites and private configuration.

## Install from the repository marketplace

Register the marketplace with the CLI:

```sh
codex plugin marketplace add https://github.com/recluse-studio/glassport.git
```

The repository contains `.agents/plugins/marketplace.json`, whose local entry points to its root. In the ChatGPT desktop app, restart or refresh, open the Plugins Directory, select the Glassport marketplace and install Glassport. Test in a new tool session. The [official packaging guide](https://developers.openai.com/plugins/build/plugins) distinguishes these local sources from the universal public directory.

The desktop-bundled CLI used to verify this release also supports:

```sh
codex plugin add glassport@glassport
codex plugin list --marketplace glassport --json
```

Check `codex plugin --help` before using that alternative; CLI availability can vary. If a shell wrapper is broken, use the actual CLI distributed with your desktop app rather than replacing account configuration or credentials.

For updates, refresh the registered marketplace using `codex plugin marketplace upgrade glassport`, reinstall/refresh Glassport through the supported client and verify the installed version. The local host loads its cached installed copy, not the editable source folder. Restart or refresh the client and use a new tool session after changes.

## Select the application workspace

Complete [Setup](../skills/glassport/references/setup.md) in a persistent application checkout, then invoke `$glassport`. Call `glassport_configure` with that existing checkout and `glassport_open` to start or reuse its local service. Open the returned loopback URL in Codex's internal browser, select the verified paired iPad and connect there.

The selected workspace is saved privately in `~/.local/share/glassport/mcp-workspace.json`. An explicit `GLASSPORT_WORKSPACE` environment value overrides that saved selection for isolated verification. Keep device state outside the plugin cache. Neither installation nor configuration creates trust, accepts software agreements or changes device security settings.

## Tool reference

| Tools | Behavior |
| --- | --- |
| `glassport_configure`, `glassport_open` | Select the persistent installation; start/reuse its service. |
| `glassport_status`, `glassport_devices`, `glassport_apps` | Read service, device and installed-app metadata. |
| `glassport_view`, `glassport_capture` | Return a fresh actual image; explicitly save a capture. |
| `glassport_tap`, `glassport_swipe` | Send input using current logical geometry and generation. |
| `glassport_type`, `glassport_key`, `glassport_open_app` | Paste text, send a separate key or open an installed bundle. |
| `glassport_clipboard` | Read public clipboard text; optionally send Copy and require a changed value. |
| `glassport_documents`, `glassport_import_file` | Browse supported Documents sharing and import verified bytes. |
| `glassport_artifacts`, `glassport_read_artifact` | List saved artifacts and return text/images with hashes. |
| `glassport_collect`, `glassport_save_collection` | Preserve ordered copied passages and save Markdown. |

Inspect `glassport_view` before and after input. Commands require its generation; stale session generations are rejected. Text insertion does not add Enter. Enter, taps or app actions that submit content require the corresponding user authority. Uncertain input must not be replayed automatically.

Clipboard reads can take 90 seconds and can describe a previous copy. Saved-artifact results describe saved coverage rather than a current app view. Binary formats other than supported text/images remain available through the browser. Large text results are limited to 262,144 characters, with truncation metadata.

## Access and connection scope

This package uses local stdio and an authenticated loopback application. It has no remote OAuth server and requests no OAuth scopes. MCP delegates only allowlisted endpoints through an expiring `0600` credential and preserves the active browser owner. Connecting or replacing a device belongs to the browser.

The device connection requires existing pairing and the native screen/input services. Optional Tailscale access uses the user's configured trusted route. The host may prompt for persistent local plugin access or tool actions according to its own settings; inspect and approve that concrete request when needed. Do not change those settings merely to make a tool pass.

## Build and distribute

```sh
npm ci
npm run build:mcp
npm run typecheck
npm test
npm run verify:mcp
python3 scripts/package-plugin.py
```

The package script selects public source, documentation and licenses explicitly. It rejects private-state directories, symlinks and common disclosure patterns. It never packages operational receipts, pairing state, captures or app exports. The generated archive and receipt are local release artifacts under ignored `.release/`.

Original code is MIT. The native bridge retains GPL-3.0-or-later, and the bundle retains the used Node dependencies' licenses. Keep [Third-party notices](../THIRD_PARTY_NOTICES.md) with the source.

Local distribution is independent of public-directory submission. No directory approval or publication is claimed by this release. It does not create or modify a directory submission.
