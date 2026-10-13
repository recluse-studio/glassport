# License scope and retained sources

Original Glassport web, Node server, contracts, adapter integration, documentation and tooling use the MIT license in LICENSE. Third-party material retains its own license. This statement does not relicense dependency code or copied research snapshots.

`scripts/native-bridge.py` contains a modified VideoToolbox worker based on pymobiledevice3 11.28.2, especially `remote/core_device/vt_jpeg.py`. That bridge is GPL-3.0-or-later, as identified in its source header; the full license is in LICENSES/GPL-3.0-or-later.txt. Upstream package metadata names doronz88, matan and the pymobiledevice3 contributors. Glassport modifications include native AVCC input, bounded encoded and pixel queues, rate-limited pixel copying, orientation mapping and private stdio integration.

The pinned pymobiledevice3 package is GPL-3.0-or-later. Its source, package metadata and license remain in the project-private installation, and its upstream repository is https://github.com/doronz88/pymobiledevice3. The browser/Node application invokes the native bridge as a separate owned process. This repository does not claim that the combined native distribution is exclusively MIT.

Retained upstream sources and research page snapshots are evidence, not original Glassport code. Preserve their notices and distribution restrictions. Public-release preparation must inventory these files and omit nonredistributable/private research evidence from the public Git index while keeping the local originals. Device records, captures, downloaded app content, pairing records and runtime files stay ignored. No dependency installation or research snapshot is reissued under the project MIT license.
