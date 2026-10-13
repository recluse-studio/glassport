# Glassport operating runbook

This runbook describes the native local preview. Read [Verification](VERIFICATION.md) for the observed physical behavior and remaining unexecuted cases.

## Reference installation

| Component | Current reference |
| --- | --- |
| Checkout | A persistent writable application checkout |
| Browser server | `http://127.0.0.1:43180/`, Mac loopback only |
| Mac | Apple Silicon macOS with VideoToolbox |
| Device | Trusted physical iPad, iPadOS 27 or later |
| Active transport | Paired native RemotePairing over Tailscale |
| Native client | `pymobiledevice3==11.28.2` |
| USB utility runtime | Project-private Python 3.12 |
| Network runtime | Project-private Python 3.13.14 with native TLS-PSK |
| Browser/server runtime | Node 24 or later; reference 24.11.1 |
| Release state | Local preview; extended verification incomplete |

The exact UDID, addresses and pairing secrets belong in ignored `runtime/`, not a public setup example. Confirm the actual OS, Developer Mode, pairing and support-image state during setup.

## Start

1. Confirm the persistent checkout exists.
2. Unlock the iPad. Confirm Tailscale is connected to the same intended tailnet on both devices when using the network configuration.
3. Run the launch command and keep its terminal alive.

```sh
cd /path/to/glassport
./scripts/start.sh
```

4. Wait for `runtime/server.log` to report Glassport ready. The launcher's starting message precedes the actual listener.
5. Open `http://127.0.0.1:43180/` in the Codex internal browser.
6. Select the Connection icon, choose the configured paired iPad and click Connect.
7. Verify a current device picture and enabled input controls. Click a safe field or perform a harmless navigation action to confirm actual control.

Do not treat a Tailscale pong, an online peer or a healthy server as a usable iPad session. The wireless receipt verifies real display and input after cable removal; distinct-network routed operation is a separate unexecuted test.

## Stop

Use Disconnect to cancel pending typing and close the native session. Then run:

```sh
cd /path/to/glassport
./scripts/stop.sh
```

The stop utility verifies each recorded PID's command and repository path before signalling it. It does not stop unrelated user processes. Ctrl+C in the owned launcher also requests shutdown. Saved exports remain in the application checkout.

## Connect, reconnect and ownership

One browser tab owns device input. Reloading that tab retains its per-tab identity and can recover the existing session. A different tab cannot silently control it. If a second tab reports another controller, return to the owning tab and disconnect there.

Connect verifies the returned device identity, supported OS, Developer Mode, display capability and support data. It uses the configured network endpoint when present; a network failure does not silently fall back to USB. Existing trust is authenticated with `autopair=False`.

Retry refreshes current state and inventory. It is not an automatic replay of uncertain commands. If the native worker has ended, disconnect and reconnect through the owning page. Inspect the exact error before repeating an input whose visible result is unknown.

## Interface

The screen is the main pane. The toolbar uses labelled icons; hover or keyboard focus reveals their names. Each tool panel opens below the screen and scrolls inside its own region.

| Tool | Daily use |
| --- | --- |
| Connection | Select device, connect, disconnect, retry and inspect discovery. |
| Home | Navigate to the iPad Home screen using the native Home action. |
| Apps | Open actual installed Teams, Outlook, Copilot or the selected installed app. |
| Paste | Insert text into the focused iPad field and send an explicit separate key. |
| Copy | Copy selected text, read current clipboard or copy returned text to the Mac. |
| Files | Import an exported document; collect and save returned clipboard text. |
| Camera | Save the current iPad picture with observation provenance. |
| Expand | Hide toolbar and panels; Escape restores controls. |
| Diagnostics | Inspect actual worker, session, geometry, media and last command. |

The image follows native display metadata, preserves aspect ratio and uses the same rotation transform for pointer input. Physical portrait/landscape transition checks remain part of acceptance. Audio is deferred and does not block this build.

## Laptop typing

Click the intended field inside the iPad picture. Ordinary laptop keystrokes operate that field. Supported separate keys include Backspace, arrows, Tab, Escape and Enter. Device apps can apply their normal auto-capitalization and text formatting.

Unicode composition and paste use the device pasteboard followed by an awaited native paste chord. A paste action never adds Enter. Typing into Glassport's own textarea, path field or selectors remains local.

The input queue holds at most 64 entries and coalesces character bursts into bounded chunks. A failure or ownership/connection change cancels the remaining input. Glassport does not automatically repeat an uncertain command.

Before pressing Enter, inspect the actual iPad app. Enter can submit a message or prompt; text insertion itself does not authorize submission.

## Paste into iPad

1. Click the intended actual iPad text field.
2. Open Paste and enter text in the local textarea, or use the browser's paste event on the focused picture.
3. Click Paste into iPad.
4. Inspect the actual field to confirm the result.

Long and multiline text should use the paste path. The textarea remains local until the explicit paste action. A dispatch acknowledgement and a visible result are different evidence boundaries.

## Copy from iPad

Select the desired text on the device and click Copy selected text from iPad. Glassport records the prior clipboard, sends Cmd+C and requires a changed clipboard before calling it a fresh copy. The returned text appears in a labelled selectable DOM region that Codex's browser tools can read.

For apps with their own Copy menu, use that native action, then Read iPad clipboard. This route intentionally reports `device_clipboard`; it cannot claim the value originated from a newly requested Glassport copy. Correlate the actual menu action and displayed content when collecting evidence.

Copy source records time, method, format, coverage and warnings. Native foreground app identity is presently unavailable and is reported as unknown; opening an app is not itself proof that the app stayed foreground.

Rich clipboard formats may resolve slowly. A public-text read is bounded at 90 seconds, with a 100-second host deadline. The native client documents that loading every rich representation can take about 64 seconds. The interface displays progress. A timeout remains a failed transfer, rather than returning an older value as a new copy.

Only ordinary public plain-text formats are decoded. Managed private formats retain their protection. Use the exact observed result when diagnosing an app.

Click Copy to Mac clipboard after the intended text returns. The earlier physical campaign checked this action against synthetic Unicode text. Clear removes unsaved returned content and collections; it preserves saved exports.

## Real document import

The current importer uses Apple document sharing, limited to an installed app's supported `Documents` exports. It does not expose arbitrary private storage.

1. In the iPad app, create or export the intended document through its supported interface.
2. Open Files in Glassport.
3. Choose the exporting installed app.
4. Enter its relative document path, for example `Documents/export.pdf`.
5. Click Import iPad file.
6. Open the saved artifact link and verify filename, byte length and hash.

The importer accepts regular files up to 32 MiB and rejects traversal, absolute paths, links and changing source files. Allowed extensions are PDF, TXT, MD, CSV, JSON, DOCX, XLSX, PPTX, PNG, JPG, JPEG, ZIP and RTF. Source and received SHA-256 hashes must match. A private container reported inaccessible remains inaccessible.

The manual path must identify a real file in the permitted document-sharing container. An online app or an installed bundle is not proof that it exports a file. The earlier physical campaign imported a synthetic iPad-created export with identical source, saved and downloaded bytes; see [Verification](VERIFICATION.md).

## Captures and collections

The Camera icon saves the current native frame with observation metadata. It rejects stale/unavailable frames. Files displays an authenticated artifact link.

Add clipboard to collection reads the current device clipboard and appends one ordered view. Repeated chunks are preserved explicitly. Save collection produces a Markdown artifact with each view's capture time, method and observed coverage. A collection never claims whole-document access from a few copies.

The session permits at most 8 collections and 50 views per collection. The export folder permits 200 saved artifacts, including artifacts retained across service restarts. At that limit, preserve or move saved exports explicitly before adding more. Disconnect clears unsaved collections. Explicitly saved files remain in `exports/` and are verified against their saved hash whenever retrieved.

## Diagnostics

```sh
cd /path/to/glassport
npm run doctor
lsof -nP -iTCP:43180 -sTCP:LISTEN
```

Doctor reports current local discovery and Tailscale state. Its localService field checks the exact Glassport health endpoint. Its historical_appium field describes only the historical adapter. Use the browser Diagnostics panel for the actual worker and stream.

Useful native fields are frame age/count, access-unit age, decoder queue, keyframe requirement and task completion/errors. Fresh encoded units with stale decoded pictures indicate a decoder/keyframe problem. No socket or stale access units indicate a transport/stream problem. Browser display failure with fresh native frames is a separate browser connection problem. Browser display counters measure canvas paints and distinct frame hashes; the browser keeps one pending JPEG rather than a playback backlog. A stale picture pauses input and shows an indicator on the screen. A recovered stream clears its transient warning without opening or rearranging the tool panel.

The selected controller state and last command include accepted/finished timestamps, command identity and acknowledgement. `DISPATCHED` means the native input call returned; it still requires visual inspection. `UNKNOWN` means execution may have occurred and must not be blindly replayed.

## Recovery table

| Observed condition | Next action |
| --- | --- |
| Port43180 occupied | Inspect its listener. Leave unrelated software running; stop only an identified owned Glassport instance. |
| Application checkout absent | Make the chosen persistent installation available before launch. |
| Wrong or offline tailnet peer | Compare current device addresses and account with private configuration; establish the intended tailnet using existing authorization. |
| Pair verification fails | Recheck the existing trusted pair record and exact device. Do not create trust or change developer/security settings silently. |
| OS below 27 | Native screen control is unavailable. Report the actual service/version result; no Xcode prompt fixes it. |
| Device locked or app authentication required | Let the user unlock/authenticate on the device. Do not collect passcodes or passwords. |
| Picture older than 2 seconds | Refresh observation; inspect diagnostics before input. |
| Browser picture lost, native frames current | Reload the owning page. Preserve uncertain command outcomes; do not resend input automatically. |
| Native worker lost | Disconnect, reconnect and verify a fresh picture plus a harmless action. |
| COPY_UNCHANGED | Select intended device text and copy again. Do not report an old clipboard value as a new copy. |
| CLIPBOARD_RESOLUTION_TIMEOUT | Keep the failure explicit. Check source app and rich representation behavior before retrying. |
| No readable public text | Inspect format metadata and actual app policy; do not decode a protected private representation. |
| File unavailable | Check the permitted exported document path and exporter support; do not expand to private app storage. |
| File changed during read | Export a stable copy, then retry the explicit import. |

Transient-network, helper-restart and lock/unlock acceptance tests remain distinct from a normal page reload. Preserve their actual outcomes in the acceptance report.

## Runtime custody and bounds

| Path | Purpose |
| --- | --- |
| `runtime/device-config.json` | Private selected-device network/app configuration. |
| `runtime/apple-device/` | Existing device pair records and native support state. |
| `runtime/ios-tmp/` | Configured native temporary files. |
| `runtime/*.pid`, `server.json` | Owned process identity and listener metadata. |
| `runtime/*.log` | Bounded local process logs; normal command/screen content is omitted. |
| `.local/ios/` | Pinned USB/native utility virtual environment. |
| `.local/ios-network/` | Pinned network runtime with native TLS-PSK. |
| `exports/` | Explicitly saved local artifacts. |
| `private-evidence/` | Retained operational receipts and private verification records. |

The native bridge bounds encoded units, pixel buffers, queues and file payloads. The Node media reader caps its buffer at 8 MiB and a JPEG at 4 MiB. The stdio RPC caps 16 pending requests, 64 KiB request lines and 48 MiB response buffering. Routine process logs rotate at 2 MiB. Monitor system data-volume free space before growth; stop space-consuming activity below 10 percent free.

## Dependency maintenance

Review the pinned requirements and source compatibility before updates. The active network environment requires Python 3.13 or later with native TLS-PSK; the observed3.12 SSLPSK route failed tunnel negotiation with NO_CIPHERS_AVAILABLE.

```sh
npm ci
npm run typecheck
npm test
PIP_CACHE_DIR="$PWD/.local/pip-cache" .local/ios/bin/python -m pip install --only-binary=:all: -r scripts/ios-requirements.txt
PIP_CACHE_DIR="$PWD/.local/pip-cache" .local/ios-network/bin/python -m pip install --only-binary=:all: -r scripts/ios-network-requirements.txt
```

These commands assume the appropriate virtual environments already exist. Preserve the trusted pair records. A recreated environment is not a pairing operation. No Xcode agreement or signing renewal is needed for the current native route. A configured legacy Appium route requires a separately installed XCUITest driver, has separate signing requirements and cannot be substituted silently. The default installation uses appium-ios-device directly for native discovery and excludes that driver.

After a native-client update, verify exact identity, stream admission, geometry, HID, public clipboard and document-sharing behavior on the real iPad. Retain third-party license notices. The upstream native dependency is GPL-3.0-or-later; release licensing must distinguish original MIT code from adapted native code and retained sources before publication.

## Verification and handoff

Run focused engineering checks for changed local contracts. Execute physical cases through the actual Codex internal browser and identified iPad. A mocked unit test cannot establish display, input or transfer.

See [Verification](VERIFICATION.md) for the scope of earlier observations and current automated checks. Full orientation transitions, distinct-network operation and the complete recovery/performance campaign remain unverified. Keep private device receipts and screenshots outside the public index and release package.

## Uninstall inventory

Disconnect and stop the owned product first. Project-created virtual environments, Node dependencies, runtime logs and disposable test products can be regenerated from pinned sources. Pair records, private evidence and saved exports have separate retained value; preserve them before any authorized deletion.

Glassport does not uninstall device apps, clear their accounts, revoke trust, change organizational policies or remove Tailscale. Removing the checkout does not authorize changing those systems. Obtain explicit authority before deleting user-owned data or anything whose ownership is unclear.

## Code-backed MCP operation

Glassport 0.2.1 includes a standalone stdio MCP server. Install the plugin from the repository marketplace as described in `docs/PLUGIN.md`. Configure the persistent application workspace with `glassport_configure`; the selected path is stored in `~/.local/share/glassport/mcp-workspace.json` with mode 0600, outside the plugin cache. `glassport_open` starts or reuses the service. Connect the iPad in the browser before device tools. Inspect `glassport_view` before input and after an action. The returned logical geometry and generation govern pointer coordinates and stale-command rejection.

The same browser-owned native session handles both interfaces. MCP cannot connect an unselected device or override a browser owner. Private loopback credentials expire after 12 hours and are regenerated at application start. Stop using `./scripts/stop.sh`; keep unrelated processes, saved exports and trusted pairing intact. A new or refreshed Codex plugin tool session may be needed after installation.

The MCP protocol verifier exercises a real stdio connection with synthetic local data. It does not connect an iPad or prove current physical control.
