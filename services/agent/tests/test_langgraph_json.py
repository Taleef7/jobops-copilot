"""Tests for LangGraph Studio debugging manifest (langgraph.json) (#257)."""

import importlib
import json
from pathlib import Path

from app.graph.registry import AGENT_IDS

AGENT_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = AGENT_ROOT / "langgraph.json"


def _load_manifest() -> dict:
    assert MANIFEST_PATH.is_file(), f"langgraph.json not found at {MANIFEST_PATH}"
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        return json.load(f)


def test_manifest_exists_and_parses():
    data = _load_manifest()
    assert isinstance(data, dict)
    assert "graphs" in data
    assert isinstance(data["graphs"], dict)


def test_manifest_covers_assistant_and_all_agents():
    data = _load_manifest()
    graphs = data["graphs"]

    assert "assistant" in graphs
    for agent_id in AGENT_IDS:
        assert agent_id in graphs, f"Missing {agent_id} in langgraph.json graphs"


def test_manifest_targets_resolve():
    data = _load_manifest()
    graphs = data["graphs"]

    for name, target in graphs.items():
        assert ":" in target, (
            f"Target '{target}' for graph '{name}' must have format '<path>:<callable>'"
        )
        mod_part, attr_name = target.split(":", 1)

        # Handle file paths like "./app/graph/assistant.py" or module paths
        cleaned_mod = mod_part.strip()
        if cleaned_mod.startswith("./"):
            cleaned_mod = cleaned_mod[2:]
        if cleaned_mod.endswith(".py"):
            cleaned_mod = cleaned_mod[:-3]
        module_path = cleaned_mod.replace("/", ".").replace("\\", ".")

        mod = importlib.import_module(module_path)
        factory = getattr(mod, attr_name, None)
        assert factory is not None, (
            f"Could not find attribute '{attr_name}' in module '{module_path}' for graph '{name}'"
        )
        assert callable(factory), (
            f"Target '{attr_name}' in module '{module_path}' for graph '{name}' must be callable"
        )
