#!/usr/bin/env bash
# Unit tests for agent-model-guard.sh (#410). No Azure calls: az is a shell-function stub,
# and the Azure CLI gets an empty config dir, so even a real az would have no login.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
AZURE_CONFIG_DIR="$(mktemp -d)"
export AZURE_CONFIG_DIR
TMP_TREE="$(mktemp -d)"
trap 'rm -rf "$AZURE_CONFIG_DIR" "$TMP_TREE"' EXIT

FAKE_MODEL=""
az() {
  if [ "$1 $2" = "containerapp show" ]; then
    printf '%s\r\n' "$FAKE_MODEL" # az in Git Bash on Windows ends its lines with \r
    return 0
  fi
  echo "unexpected az call: $*" >&2
  return 99
}
[ "$(type -t az)" = "function" ] || { echo "FAIL: az is not the stub"; exit 1; }

# shellcheck source=scripts/azure/agent-model-guard.sh
source "$DIR/agent-model-guard.sh"
cd "$REPO" || exit 1

fail=0
expect() { # label, expected exit code, live model, git ref, [ALLOW_UNVERIFIED_AGENT]
  local label="$1" want="$2" ref="$4" got
  FAKE_MODEL="$3"
  (ALLOW_UNVERIFIED_AGENT="${5:-}" require_agent_supports_live_model rg app "$ref") >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then echo "ok: $label"; else echo "FAIL: $label (want $want, got $got)"; fail=1; fi
}

# The commit that added openai_call_kwargs, and its parent from before #410.
new_ref="$(git log -n 1 --format=%H -S 'def openai_call_kwargs' -- services/agent/app/llm/provider.py)"
[ -n "$new_ref" ] || { echo "FAIL: no commit adds openai_call_kwargs (shallow clone?)"; exit 1; }
old_ref="$new_ref~1"

expect "luna live: an image from before #410 is refused" 1 gpt-6-luna "$old_ref"
expect "luna live: an image from #410 on is allowed" 0 gpt-6-luna "$new_ref"
expect "luna live: an unknown tag is refused" 1 gpt-6-luna 202610030101
expect "luna live: ALLOW_UNVERIFIED_AGENT=1 skips the check" 0 gpt-6-luna "$old_ref" 1
expect "nano live: any image is allowed" 0 gpt-5.4-nano "$old_ref"
expect "no model read: any image is allowed" 0 "" "$old_ref"
expect "luna live, build mode: this working tree is allowed" 0 gpt-6-luna ""

# Build mode checks the files being built, not HEAD: an old provider.py in the tree is refused.
mkdir -p "$TMP_TREE/services/agent/app/llm"
git show "$old_ref:services/agent/app/llm/provider.py" > "$TMP_TREE/services/agent/app/llm/provider.py"
cd "$TMP_TREE" || exit 1
expect "luna live, build mode: an old provider.py in the tree is refused" 1 gpt-6-luna ""
cd "$REPO" || exit 1

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; exit 1; fi
