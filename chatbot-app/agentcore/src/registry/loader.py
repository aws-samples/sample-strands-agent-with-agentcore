"""Registry-based service discovery.

Convenience accessors that delegate to RegistryClient. These maintain the
same function signatures consumed by SkillChatAgent and tool_filter so
call-sites don't change.
"""

from typing import Dict

from .client import get_registry_client


def get_tool_to_skill_map() -> Dict[str, str]:
    client = get_registry_client()
    if not client:
        return {}
    return client.tool_to_skill_map()


def get_mcp_runtime_skills() -> set:
    client = get_registry_client()
    if not client:
        return set()
    return client.mcp_runtime_skills()


def get_a2a_skill_tools() -> Dict[str, str]:
    client = get_registry_client()
    if not client:
        return {}
    return client.a2a_skill_tools()
