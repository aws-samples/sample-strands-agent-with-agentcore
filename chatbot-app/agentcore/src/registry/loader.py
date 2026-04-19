"""Registry YAML loader.

Reads infra/registry/definitions/{mcp,a2a,skills}/*.yaml and exposes:
  - MCP tool schemas (gateway-routed)
  - A2A agent cards
  - Skill descriptors with source (gateway | mcp | a2a) and tool list

Single source of truth for everything that used to be hardcoded in
skill_chat_agent.py (MCP_TOOL_SKILL_MAP, A2A_SKILL_TOOLS, _MCP_RUNTIME_SKILLS)
and in infra/modules/gateway/tool-schemas.json.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

# In-container layout: /app/registry_definitions/ (synced from infra/ by deploy.sh).
# In-repo layout:      infra/registry/definitions/ (relative to repo root).
# REGISTRY_DEFS_ROOT env var overrides both.
_APP_ROOT = Path(__file__).resolve().parents[2]  # src/registry/loader.py -> agentcore/
# Walking up two more levels reaches the repo root when running from source.
# In the container (_APP_ROOT == /app) there's no repo root, so guard against
# IndexError from pathlib.PurePath.parents.
_repo_parents = _APP_ROOT.parents
_REPO_ROOT = _repo_parents[1] if len(_repo_parents) > 1 else _APP_ROOT
_CANDIDATES = [
    _APP_ROOT / "registry_definitions",
    _REPO_ROOT / "infra" / "registry" / "definitions",
]


def _resolve_default_defs_root() -> Path:
    for p in _CANDIDATES:
        if p.is_dir():
            return p
    # Fall through; loader will warn at access time.
    return _CANDIDATES[0]


_DEFAULT_DEFS_ROOT = _resolve_default_defs_root()


class RegistryLoader:
    def __init__(self, defs_root: Optional[Path] = None):
        self.defs_root = Path(defs_root) if defs_root else _DEFAULT_DEFS_ROOT
        self._mcp: Optional[Dict[str, dict]] = None
        self._a2a: Optional[Dict[str, dict]] = None
        self._skills: Optional[Dict[str, dict]] = None

    def _load_dir(self, subdir: str) -> Dict[str, dict]:
        path = self.defs_root / subdir
        if not path.is_dir():
            logger.warning("Registry definitions dir missing: %s", path)
            return {}
        out: Dict[str, dict] = {}
        for f in sorted(path.glob("*.yaml")):
            try:
                data = yaml.safe_load(f.read_text()) or {}
                name = data.get("name") or f.stem
                out[name] = data
            except Exception as e:
                logger.error("Failed to parse %s: %s", f, e)
        return out

    @property
    def mcp(self) -> Dict[str, dict]:
        if self._mcp is None:
            self._mcp = self._load_dir("mcp")
        return self._mcp

    @property
    def a2a(self) -> Dict[str, dict]:
        if self._a2a is None:
            self._a2a = self._load_dir("a2a")
        return self._a2a

    @property
    def skills(self) -> Dict[str, dict]:
        if self._skills is None:
            self._skills = self._load_dir("skills")
        return self._skills

    def tool_to_skill_map(self) -> Dict[str, str]:
        """Reverse map: individual tool name → skill name.

        Built from skill YAMLs where `tools: [...]` is declared. This is the
        canonical mapping used by SkillChatAgent to tag MCP tools with skill
        metadata.
        """
        out: Dict[str, str] = {}
        for skill_name, data in self.skills.items():
            for t in data.get("tools") or []:
                if t in out:
                    logger.warning(
                        "Tool '%s' mapped to both '%s' and '%s'; keeping first",
                        t, out[t], skill_name,
                    )
                    continue
                out[t] = skill_name
        return out

    def mcp_runtime_skills(self) -> set[str]:
        """Skills whose tools live on the MCP 3LO Runtime (source: mcp)."""
        return {name for name, data in self.skills.items() if data.get("source") == "mcp"}

    def a2a_skill_tools(self) -> Dict[str, str]:
        """agent-id prefixed tool id → skill name, for A2A agents.

        Convention matches SkillChatAgent: `agentcore_<skill_name>`.
        """
        return {
            f"agentcore_{name}": name
            for name, data in self.skills.items()
            if data.get("source") == "a2a"
        }


@lru_cache(maxsize=1)
def get_loader() -> RegistryLoader:
    env_root = os.getenv("REGISTRY_DEFS_ROOT")
    return RegistryLoader(Path(env_root) if env_root else None)


# Convenience accessors (keep call-sites terse)
def get_tool_to_skill_map() -> Dict[str, str]:
    return get_loader().tool_to_skill_map()


def get_mcp_runtime_skills() -> set[str]:
    return get_loader().mcp_runtime_skills()


def get_a2a_skill_tools() -> Dict[str, str]:
    return get_loader().a2a_skill_tools()
