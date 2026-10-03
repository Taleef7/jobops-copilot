# Sourced by deploy-agent.sh. Defines a function only; sourcing it changes nothing.
#
# A gpt-6 model needs an agent that sends it no temperature and calls tools through the
# Responses API (#410). An older image on that env fails every call, as #329 did, so the
# model has to be rolled back before the image is.

# require_agent_supports_live_model <resource-group> <app> <git-ref>
# Exits 1 when the app's live OPENAI_MODEL is a gpt-6 model and <git-ref>'s agent can't
# call it. ALLOW_UNVERIFIED_AGENT=1 skips the check for an image built from elsewhere.
require_agent_supports_live_model() {
  local rg="$1" app="$2" source_ref="$3" live_model
  live_model="$(az containerapp show -g "$rg" -n "$app" \
    --query "properties.template.containers[0].env[?name=='OPENAI_MODEL'].value | [0]" -o tsv 2>/dev/null || true)"
  case "$live_model" in
    gpt-6*)
      if [ "${ALLOW_UNVERIFIED_AGENT:-}" != "1" ] &&
        ! git show "$source_ref:services/agent/app/llm/provider.py" 2>/dev/null | grep -q "def openai_call_kwargs"; then
        echo "==> Refusing: the agent runs $live_model, and $source_ref's code can't call it (#410)." >&2
        echo "    Roll the model back first, then activate:" >&2
        echo "    az containerapp update -g $rg -n $app --set-env-vars OPENAI_MODEL=gpt-5.4-nano" >&2
        echo "    (If $source_ref isn't in this checkout, git fetch first. For an image built from" >&2
        echo "    elsewhere, ALLOW_UNVERIFIED_AGENT=1 skips this check.)" >&2
        exit 1
      fi
      ;;
  esac
}
