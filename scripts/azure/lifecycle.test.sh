#!/usr/bin/env bash
# Unit tests for lifecycle.sh dispatch/usage (no Azure calls).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source without running main() — lifecycle.sh guards main behind a BASH_SOURCE check.
# shellcheck source=/dev/null
source "$DIR/lifecycle.sh"
set +e  # lifecycle.sh enables -e; disable it so assertions can observe failures.

fail=0
bash "$DIR/lifecycle.sh" >/dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok: no-arg exits 2" || { echo "FAIL: no-arg exit code"; fail=1; }
bash "$DIR/lifecycle.sh" bogus >/dev/null 2>&1; [ "$?" -eq 1 ] && echo "ok: bad subcommand exits 1" || { echo "FAIL: bad subcommand exit code"; fail=1; }
bash "$DIR/lifecycle.sh" --help >/dev/null 2>&1; [ "$?" -eq 0 ] && echo "ok: --help exits 0" || { echo "FAIL: --help exit code"; fail=1; }

help_out="$(bash "$DIR/lifecycle.sh" --help 2>&1)"
for sub in pause resume status; do
  printf '%s' "$help_out" | grep -q "$sub" && echo "ok: help mentions $sub" || { echo "FAIL: help missing $sub"; fail=1; }
done

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; exit 1; fi
