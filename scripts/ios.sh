#!/bin/sh
set -eu
GLASSPORT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$GLASSPORT_ROOT/.local/ios/bin/python" -u "$GLASSPORT_ROOT/scripts/ios.py" "$@"
