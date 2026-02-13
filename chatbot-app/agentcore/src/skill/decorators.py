"""
Skill metadata — marks @tool functions as belonging to a skill.

Description comes from SKILL.md frontmatter (single source of truth),
so decorators only need the skill name.

Two ways to use:

1. Decorator (single tool per skill):
    @skill("web-search")
    @tool
    def ddg_web_search(...): ...

2. Batch registration (multiple tools per skill):
    register_skill("browser-automation", tools=[browser_navigate, browser_act, ...])
"""

from strands import tool as strands_tool


def _apply_skill_metadata(tool_obj, name: str):
    """Attach skill name to a single tool object."""
    tool_obj._skill_name = name


def skill(name: str):
    """Decorator: attach skill name to a single @tool function.

    Args:
        name: Skill identifier (e.g. "web-search"). Must match a
              directory name under skills/ that contains a SKILL.md.
    """

    def decorator(func_or_tool):
        if not hasattr(func_or_tool, "tool_name"):
            wrapped = strands_tool(func_or_tool)
        else:
            wrapped = func_or_tool

        _apply_skill_metadata(wrapped, name)
        return wrapped

    return decorator


def register_skill(name: str, tools: list):
    """Batch-register multiple @tool functions under one skill.

    Call once per file, at module level, after all tool functions are defined.

    Args:
        name: Skill identifier (e.g. "browser-automation"). Must match a
              directory name under skills/ that contains a SKILL.md.
        tools: List of @tool-decorated function objects.
    """
    for tool_obj in tools:
        _apply_skill_metadata(tool_obj, name)
