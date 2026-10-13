# Glassport plugin release

The 0.1.0 package contains the local app source, the Glassport Codex skill, pinned dependency manifests, license notices, README and runbook. The skill uses Codex’s browser/computer-use tools to operate the same local interface as the user. It includes no lifecycle hook and no public device-control endpoint. Install prerequisites are declared in `skills/glassport/references/setup.md`.

Build the public submission ZIP with:

```sh
python3 scripts/package-plugin.py
```

The script selects source files explicitly. It excludes private runtime configuration, pair records, installed dependencies, captures, app data, exported files, raw research snapshots and development worklogs. ZIP metadata and source-content inventory are saved beside the package in ignored `.release/`. The GitHub source repository retains shareable specs and redacted receipts separately.

Official directory submission uses https://platform.openai.com/plugins. Select the intended organization and verified Recluse Studio publishing identity, upload the ZIP, resolve the portal’s package/skill checks and submit for review. A prepared ZIP or a public Git repository is not an official submission receipt. Any legally binding publishing agreement requires the human’s confirmation at that step. Do not substitute another publisher identity.

Current official guidance: https://developers.openai.com/plugins/build/plugins and https://developers.openai.com/plugins/deploy/submission. The submission attempt and its actual outcome are retained in `records/plugin-submission.json`.

Original Glassport code is MIT. `scripts/native-bridge.py` and the pinned native dependency retain GPL-3.0-or-later; both licenses and THIRD_PARTY_NOTICES.md accompany the package. The package manifest states the combined license scope.

The reference device’s core display, control, laptop input, native text retrieval and real file transfer are proved. Extended orientation, fault-injection and metric cases not reached before the user ended testing remain deferred. Do not advertise those as certified. The application is stopped at handoff and restarts with `./scripts/start.sh`.
