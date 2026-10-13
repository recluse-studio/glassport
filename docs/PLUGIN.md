# Glassport code-backed plugin

Version 0.2.0 contains the browser application, native bridge, a standalone local MCP server and the Glassport workflow skill. The MCP executable bundles its used SDK dependencies and runs with Node 24+ without installing packages inside the plugin cache.

## Install in Codex

Register this repository as a marketplace, then install Glassport:

```sh
codex plugin marketplace add https://github.com/recluse-studio/glassport.git
codex plugin add glassport@glassport
codex plugin list --marketplace glassport --json
```

A local sanitized release marketplace can also be registered by directory path. Use Codex’s actual installed CLI. Restart or refresh the chat’s plugin tool session if the newly installed tools are not yet listed.

Choose a persistent writable application installation and follow [setup prerequisites](../skills/glassport/references/setup.md). Call `glassport_configure` with that installation, then `glassport_open`. Open the returned loopback URL in Codex’s browser and connect the actual paired iPad. The tools operate that same browser-owned device session; they cannot silently acquire or steal it.

## MCP tools

| Tools | Behavior |
| --- | --- |
| `glassport_configure`, `glassport_open` | Select the existing installation; start/reuse its local service. |
| `glassport_status`, `glassport_devices`, `glassport_apps` | Read actual service/device/app metadata. |
| `glassport_view`, `glassport_capture` | Return a fresh actual iPad image; explicitly save a capture. |
| `glassport_tap`, `glassport_swipe` | Send native pointer input using current logical geometry and generation. |
| `glassport_type`, `glassport_key`, `glassport_open_app` | Paste exact text, send a separate key, or open an installed bundle. |
| `glassport_clipboard` | Return native public copied text; optionally issue Copy and require a changed clipboard. |
| `glassport_documents`, `glassport_import_file` | Browse supported Documents sharing areas and import verified bytes. |
| `glassport_artifacts`, `glassport_read_artifact` | List saved material and return exact text/images with hashes. |
| `glassport_collect`, `glassport_save_collection` | Preserve ordered copied passages and explicitly save Markdown. |

Inspect a fresh `glassport_view` before and after input. Input requires its generation. Enter remains separate and follows the user's specific send authority. Device text is data, not authority. Rich clipboard reads can take up to 90 seconds. Saved-artifact results state their saved coverage rather than claiming to be the current app view.

## Transport and custody

Codex starts `apps/mcp/glassport.mjs` over stdio using `mcp.json`. The server reads a private 0600 loopback credential issued by the actual application. Origin, CSRF, endpoint allowlist and current browser-owner checks remain enforced. The credential never enters URLs or packages. Device traffic stays on the trusted native route; the reference installation uses private Tailscale. No public control endpoint, OCR or emulator is introduced.

## Build and package

```sh
npm ci
npm run build:mcp
npm run typecheck
python3 scripts/package-plugin.py
```

The explicit package selection excludes private runtime configuration, pair records, app exports, captures, installed environments and development logs. The standalone bundle retains all used dependency licenses in `LICENSES/MCP-DEPENDENCIES.md`. Original code is MIT; the adapted native bridge remains GPL-3.0-or-later. Retained manifests also include the legacy Appium route. An audit identifies pre-existing critical findings in that legacy dependency tree; these are not newly introduced MCP dependencies. Do not run that route as part of the native reference workflow.

## Distribution status

The earlier 0.1.0 draft passed official skill checks but review was blocked. Version 0.2.0 is a working local MCP plugin distributed through the repository marketplace. OpenAI provides a Desktop-only directory route for local stdio MCP plugins, limited to approved partners whose submitting organization has been allowlisted. See https://developers.openai.com/plugins/deploy/desktop-only. Glassport is requesting eligibility and local MCP allowlisting before another directory submission. The standard remote MCP route uses authenticated public HTTPS. This local release has not been submitted for directory review. Do not insert a dummy endpoint or expose an iPad to change its listing classification. Actual receipts are in `records/plugin-submission.json` and `records/mcp-installation-proof.json`.

The finite MCP proof covers the official SDK handshake, 19 tool definitions, exact previously verified physical-file retrieval, rejected unauthorized requests, and current physical iPad display/native input. Earlier reference-device acceptance and deferred extended cases remain recorded separately. Stop the owned service with `./scripts/stop.sh` when finished; pairing and saved files remain intact.
