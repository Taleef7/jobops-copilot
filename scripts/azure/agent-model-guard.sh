# Sourced by deploy-agent.sh. Defines a function only; sourcing it changes nothing.
#
# A gpt-6 model needs an agent that sends it no temperature and calls tools through the
# Responses API (#410). An older image on that env fails every call, as #329 did, so the
# model has to be rolled back before the image is.

# require_agent_supports_live_model <resource-group> <app> [<git-ref>]
# Exits 1 when the app's live OPENAI_MODEL is a gpt-6 model and the agent at <git-ref> can't
# call it. With no ref it checks the working tree, which is what deploy-agent.sh builds.
# ALLOW_UNVERIFIED_AGENT=1 skips the check, for an image built from elsewhere.
require_agent_supports_live_model() {
  local rg="$1" app="$2" source_ref="${3:-}" live_model
  live_model="$(az containerapp show -g "$rg" -n "$app" \
    --query "properties.template.containers[0].env[?name=='OPENAI_MODEL'].value | [0]" -o tsv 2>/dev/null || true)"
  case "$live_model" in
    gpt-6*) ;;
    *) return 0 ;;
  esac
  [ "${ALLOW_UNVERIFIED_AGENT:-}" = "1" ] && return 0
  if [ -n "$source_ref" ]; then
    git grep -q -e 'def openai_call_kwargs' "$source_ref" -- services/agent/app/llm/provider.py 2>/dev/null && return 0
  else
    grep -q 'def openai_call_kwargs' services/agent/app/llm/provider.py 2>/dev/null && return 0
  fi
  local source_label="${source_ref:-the working tree}"
  echo "==> Refusing: the agent runs ${live_model%$'\r'}, and the code in $source_label can't call it (#410)." >&2
  echo "    Roll the model back first, then activate:" >&2
  echo "    az containerapp update -g $rg -n $app --set-env-vars OPENAI_MODEL=gpt-5.4-nano" >&2
  echo "    (If $source_label isn't in this checkout, git fetch first. For an image built from" >&2
  echo "    elsewhere, ALLOW_UNVERIFIED_AGENT=1 skips this check.)" >&2
  exit 1
}
