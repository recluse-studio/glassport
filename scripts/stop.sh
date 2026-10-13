#!/bin/sh
set -eu
GLASSPORT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node --experimental-strip-types "$GLASSPORT_ROOT/scripts/stop.ts"
