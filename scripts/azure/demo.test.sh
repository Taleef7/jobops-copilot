#!/usr/bin/env bash
# Unit tests for demo.sh pure helpers + dispatch (no Azure calls).
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Source without running main() — demo.sh guards main behind a BASH_SOURCE check.
# shellcheck source=/dev/null
source "$DIR/demo.sh"
set +e  # demo.sh enables -e; disable it so assertions can observe failures.

fail=0
assert_ok()   { if "$@"; then echo "ok:        $*"; else echo "FAIL (want ok):   $*"; fail=1; fi; }
assert_fail() { if "$@"; then echo "FAIL (want no):   $*"; fail=1; else echo "ok (rejected): $*"; fi; }

# Valid IPv4 addresses
assert_ok   is_ipv4 "1.2.3.4"
assert_ok   is_ipv4 "192.168.0.255"
assert_ok   is_ipv4 "50.221.78.186"
# Invalid / hostile inputs must be rejected
assert_fail is_ipv4 "256.1.1.1"
assert_fail is_ipv4 "1.2.3"
assert_fail is_ipv4 "1.2.3.4.5"
assert_fail is_ipv4 "abc"
assert_fail is_ipv4 "1.2.3.4; rm -rf /"
assert_fail is_ipv4 ""
assert_fail is_ipv4 "1.2.3.04abc"

# Dispatch: no-arg prints usage and exits 2; unknown subcommand exits 1.
bash "$DIR/demo.sh" >/dev/null 2>&1; [ "$?" -eq 2 ] && echo "ok:        no-arg exits 2" || { echo "FAIL: no-arg exit code"; fail=1; }
bash "$DIR/demo.sh" bogus >/dev/null 2>&1; [ "$?" -eq 1 ] && echo "ok:        bad subcommand exits 1" || { echo "FAIL: bad subcommand exit code"; fail=1; }
bash "$DIR/demo.sh" --help >/dev/null 2>&1; [ "$?" -eq 0 ] && echo "ok:        --help exits 0" || { echo "FAIL: --help exit code"; fail=1; }

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; exit 1; fi
