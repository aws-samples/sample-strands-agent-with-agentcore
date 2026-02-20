"""Shared utilities for Strands Agent Hooks"""


def resolve_tool_call(event) -> tuple[str, dict]:
    """Return (tool_name, tool_input) from a BeforeToolCallEvent.

    SkillChatAgent routes all tool calls through skill_executor, so the real
    tool name and input are nested inside skill_executor's input dict.
    """
    tool_name = event.tool_use.get("name", "")
    tool_input = event.tool_use.get("input", {})
    if tool_name == "skill_executor":
        tool_name = tool_input.get("tool_name", "")
        tool_input = tool_input.get("tool_input", {})
    return tool_name, tool_input
