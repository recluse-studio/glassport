#!/usr/bin/env python3
"""Select one existing Glassport feature for the official Spec Kit scripts."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEATURES = {
    'research': 'specs/001-ipad-control-research',
    'implementation': 'specs/002-browser-ipad-control',
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('feature', choices=FEATURES)
args = parser.parse_args()
directory = FEATURES[args.feature]
if not (ROOT / directory / 'spec.md').is_file():
    raise SystemExit(f'Feature specification is missing: {directory}/spec.md')
(ROOT / '.specify/feature.json').write_text(
    json.dumps({'feature_directory': directory}, indent=2) + '\n'
)
print(directory)
