# Setup prerequisites and installation

The reference build uses Apple Silicon macOS with VideoToolbox, Node 24+, uv, and a trusted physical iPad running iPadOS 27+. Developer Mode and Apple device support data are required. Tailscale must already connect the intended Mac and iPad to the same tailnet for the network route. The working reference uses pymobiledevice3 11.28.2 and Python 3.13.14 with native TLS-PSK. No paid service or OpenAI API key is required.

Use an existing working installation first. For a fresh installation, copy the bundled application source to a user-selected persistent writable folder, preserving existing files. Do not write device state into an installed plugin cache. Obtain actual missing installation authority before installing prerequisites; do not accept software agreements for the user.

From the chosen installation directory:

```sh
npm ci
UV_CACHE_DIR="$PWD/.local/uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/.local/python" uv python install 3.12.13 3.13.14
UV_CACHE_DIR="$PWD/.local/uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/.local/python" uv venv --python 3.12.13 .local/ios
UV_CACHE_DIR="$PWD/.local/uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/.local/python" uv venv --python 3.13.14 .local/ios-network
UV_CACHE_DIR="$PWD/.local/uv-cache" uv pip install --python .local/ios/bin/python --only-binary=:all: -r scripts/ios-requirements.txt
UV_CACHE_DIR="$PWD/.local/uv-cache" uv pip install --python .local/ios-network/bin/python --only-binary=:all: -r scripts/ios-network-requirements.txt
mkdir -p runtime/ios-tmp runtime/apple-device
chmod 700 runtime runtime/ios-tmp runtime/apple-device
```

The binary-only dependency rule avoids a compiler/Xcode prerequisite. Keep installation caches in the workspace and check system free space before downloads.

Use existing pairing records when available. For an unpaired device, first inspect the pinned client's applicable commands and current Apple pairing guidance. The reference installation needed one explicitly authorized USB trust/bootstrap, followed by the human enabling Developer Mode and restarting. Do not assume a missing settings entry is user error or repeatedly request Xcode. No pairing, developer-mode change, passcode entry or restart is silent. Inspect the real connected identity and current OS before giving further instructions.

A minimal private `runtime/device-config.json` has this shape; replace every placeholder with actual verified values:

```json
{
  "devices": [{
    "name": "My iPad",
    "udid": "VERIFIED-DEVICE-UDID",
    "transport": "tailscale_native",
    "nativeNetwork": {"host": "VERIFIED-100.x.x.x", "port": 49152},
    "apps": {
      "teams": "com.microsoft.skype.teams",
      "outlook": "com.microsoft.Office.Outlook",
      "copilot": "com.microsoft.officemobile"
    }
  }]
}
```

Verify the actual paired RemotePairing service port; 49152 is the reference endpoint, not a universal discovery guarantee. Confirm the exact installed app bundles before configuring shortcuts. Without `nativeNetwork`, the native adapter selects the trusted local device route. A configured network failure never falls back to USB automatically.

Run `npm run doctor`, then start and connect through the real browser. Fresh setup on another device is not certified by the reference-device receipts. Stop with `./scripts/stop.sh` when requested. Read `docs/RUNBOOK.md` for retention, maintenance and exact lifecycle details.

The installed MCP executable is self-contained and requires Node 24+. Its dependencies are bundled with full retained licenses. After application prerequisites are installed in the persistent workspace, call `glassport_configure` with that workspace. The workspace path is saved privately in `~/.local/share/glassport/mcp-workspace.json`; it never enters the plugin cache or release package. The MCP executable and application use separate installation folders but share the same authenticated browser-owned device session.
