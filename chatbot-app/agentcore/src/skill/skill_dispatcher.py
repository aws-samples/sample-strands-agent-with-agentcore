"""
Skill infrastructure tools for progressive disclosure.

  skill_dispatcher  — Level 2: loads SKILL.md instructions for the LLM
  skill_executor    — Level 3: executes a skill's tool internally and returns the result
"""

import asyncio
import concurrent.futures
import json
import logging
from strands import tool
from strands.types.tools import ToolContext

logger = logging.getLogger(__name__)

# Module-level registry reference, set by SkillChatAgent during init
_registry = None


def set_dispatcher_registry(registry) -> None:
    """Wire up the dispatcher/executor with a SkillRegistry instance."""
    global _registry
    _registry = registry


def _run_async(coro):
    """Run an async coroutine from a synchronous context.

    Handles the case where an event loop may already be running
    (e.g., inside an async framework like FastAPI).
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    else:
        return asyncio.run(coro)


@tool
def skill_dispatcher(skill_name: str, reference: str = "", source: str = "") -> str:
    """Activate a skill, read a reference document, or read a tool's source code.

    **Basic activation** — call with just skill_name to receive SKILL.md instructions:
        skill_dispatcher(skill_name="web-search")

    **Read reference doc** — call with a reference filename for additional documentation:
        skill_dispatcher(skill_name="powerpoint-presentations", reference="editing-guide.md")

    **Read source code** — call with a function name to read its implementation:
        skill_dispatcher(skill_name="powerpoint-presentations", source="create_presentation")

    Args:
        skill_name: Name of the skill to activate (e.g. "web-search")
        reference: Optional filename of a reference document to read from the skill directory.
        source: Optional function name to read its source code implementation.

    Returns:
        JSON with skill instructions, reference content, or source code
    """
    if _registry is None:
        return json.dumps({
            "error": "SkillRegistry not initialized.",
            "status": "error",
        })

    try:
        # Source code mode: return function implementation
        if source:
            code = _registry.load_source(skill_name, source)
            logger.info(f"Skill source loaded: '{skill_name}/{source}'")
            return json.dumps({
                "skill": skill_name,
                "function": source,
                "source_code": code,
                "status": "ok",
            })

        # Reference file mode: return the requested document
        if reference:
            content = _registry.load_reference(skill_name, reference)
            logger.info(f"Skill reference loaded: '{skill_name}/{reference}'")
            return json.dumps({
                "skill": skill_name,
                "reference": reference,
                "content": content,
                "status": "ok",
            })

        # Normal activation: return SKILL.md + tool list with schemas + sources + references
        instructions = _registry.load_instructions(skill_name)
        tools = _registry.get_tools(skill_name)
        sources = _registry.list_sources(skill_name)
        references = _registry.list_references(skill_name)

        # Build tool info with input schemas so the LLM knows exact parameters
        tool_schemas = []
        for t in tools:
            spec = getattr(t, "tool_spec", None)
            if spec and isinstance(spec, dict):
                schema = spec.get("inputSchema", {}).get("json", {})
                tool_schemas.append({
                    "name": t.tool_name,
                    "description": spec.get("description", ""),
                    "parameters": schema,
                })
            else:
                tool_schemas.append({"name": t.tool_name})

        logger.info(f"Skill dispatched: '{skill_name}' — tools: {[s['name'] for s in tool_schemas]}")

        result = {
            "skill": skill_name,
            "instructions": instructions,
            "available_tools": tool_schemas,
            "status": "activated",
            "next_step": "Use skill_executor to call any of the available_tools listed above.",
        }

        if sources:
            result["available_sources"] = [s["function"] for s in sources]

        if references:
            result["available_references"] = references

        return json.dumps(result)

    except KeyError as e:
        return json.dumps({
            "error": str(e),
            "available_skills": _registry.skill_names,
            "status": "error",
        })

    except (FileNotFoundError, ValueError) as e:
        return json.dumps({
            "error": str(e),
            "status": "error",
        })

    except Exception as e:
        logger.error(f"Error dispatching skill '{skill_name}': {e}")
        return json.dumps({"error": str(e), "status": "error"})


@tool(context=True)
def skill_executor(
    tool_context: ToolContext,
    skill_name: str,
    tool_name: str,
    tool_input: dict,
) -> str:
    """Execute a tool from an activated skill.

    After activating a skill with skill_dispatcher, use this tool to call
    the skill's tools. Pass the tool name and its input parameters.

    Args:
        skill_name: Name of the activated skill (e.g. "web-search")
        tool_name: Name of the tool to execute (e.g. "ddg_web_search")
        tool_input: Dictionary of input parameters for the tool
                    (e.g. {"query": "AI trends 2025", "max_results": 5})

    Returns:
        The tool's execution result
    """
    if _registry is None:
        return json.dumps({
            "error": "SkillRegistry not initialized.",
            "status": "error",
        })

    try:
        # Find the tool in the skill's tool list
        tools = _registry.get_tools(skill_name)
        target_tool = None
        for t in tools:
            if t.tool_name == tool_name:
                target_tool = t
                break

        if target_tool is None:
            available = [t.tool_name for t in tools]
            return json.dumps({
                "error": f"Tool '{tool_name}' not found in skill '{skill_name}'.",
                "available_tools": available,
                "status": "error",
            })

        logger.info(f"Executing {skill_name}/{tool_name} with input: {tool_input}")

        # Determine execution path based on tool type
        is_mcp_tool = hasattr(target_tool, 'mcp_client')

        if is_mcp_tool:
            # MCP tool — delegate to mcp_client.call_tool_sync()
            # Uses the original MCP tool name for server communication
            mcp_result = target_tool.mcp_client.call_tool_sync(
                tool_use_id=tool_context.tool_use.get("toolUseId", "skill-exec"),
                name=target_tool.mcp_tool.name,
                arguments=tool_input,
            )

            # Extract text content from MCPToolResult for the LLM
            content_parts = mcp_result.get("content", [])
            texts = []
            for part in content_parts:
                if isinstance(part, dict) and part.get("text"):
                    texts.append(part["text"])

            result = "\n".join(texts) if texts else json.dumps(mcp_result)

        else:
            # Local tool — direct function call
            call_kwargs = dict(tool_input)
            context_param = target_tool._metadata._context_param
            if context_param:
                target_context = ToolContext(
                    tool_use=tool_context.tool_use,
                    agent=tool_context.agent,
                    invocation_state=tool_context.invocation_state,
                )
                call_kwargs[context_param] = target_context

            func = target_tool._tool_func
            result = func(**call_kwargs)

            # Handle coroutines (async local tools)
            if asyncio.iscoroutine(result):
                result = _run_async(result)

        logger.info(f"Executed {skill_name}/{tool_name} successfully")
        return result

    except KeyError as e:
        return json.dumps({
            "error": str(e),
            "available_skills": _registry.skill_names,
            "status": "error",
        })

    except Exception as e:
        logger.error(f"Error executing {skill_name}/{tool_name}: {e}")
        return json.dumps({
            "error": str(e),
            "skill": skill_name,
            "tool": tool_name,
            "status": "error",
        })
