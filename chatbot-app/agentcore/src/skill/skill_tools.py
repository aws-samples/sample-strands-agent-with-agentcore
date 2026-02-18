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

        # Normal activation: return SKILL.md + tool list with schemas + sources + references + scripts
        instructions = _registry.load_instructions(skill_name)
        tools = _registry.get_tools(skill_name)
        sources = _registry.list_sources(skill_name)
        references = _registry.list_references(skill_name)
        scripts = _registry.list_scripts(skill_name)

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
            "next_step": "Use skill_executor to call tools or run scripts.",
        }

        if sources:
            result["available_sources"] = [s["function"] for s in sources]

        if references:
            result["available_references"] = references

        if scripts:
            result["available_scripts"] = scripts
            result["script_usage"] = (
                "To run a script: skill_executor("
                "skill_name='...', script_name='...', script_input={...})"
            )

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
    tool_name: str = None,
    tool_input: dict = None,
    script_name: str = None,
    script_input: dict = None,
) -> str:
    """Execute a tool or script from an activated skill.

    Tool execution:
        skill_executor(
            skill_name="web-search",
            tool_name="ddg_web_search",
            tool_input={"query": "AI", "max_results": 5}
        )

    Script execution:
        skill_executor(
            skill_name="web-search",
            script_name="cleanup_cache.py",
            script_input={"days": 30}
        )

    Args:
        skill_name: Name of the activated skill (e.g. "web-search")
        tool_name: Name of the tool to execute (mutually exclusive with script_name)
        tool_input: Dictionary of input parameters for the tool
        script_name: Name of the script to run (mutually exclusive with tool_name)
        script_input: Dictionary of input parameters for the script

    Returns:
        The tool/script execution result
    """
    if _registry is None:
        return json.dumps({
            "error": "SkillRegistry not initialized.",
            "status": "error",
        })

    # Validation: must specify either tool_name or script_name, not both
    if tool_name and script_name:
        return json.dumps({
            "error": "Cannot specify both tool_name and script_name",
            "status": "error",
        })

    if not tool_name and not script_name:
        return json.dumps({
            "error": "Must specify either tool_name or script_name",
            "status": "error",
        })

    try:
        # ========== Script Execution Path ==========
        if script_name:
            return _execute_script(
                tool_context=tool_context,
                skill_name=skill_name,
                script_name=script_name,
                script_input=script_input or {},
            )

        # ========== Tool Execution Path ==========
        if tool_name:
            return _execute_tool(
                tool_context=tool_context,
                skill_name=skill_name,
                tool_name=tool_name,
                tool_input=tool_input or {},
            )

    except Exception as e:
        logger.error(f"Error executing {skill_name}/{tool_name or script_name}: {e}")
        return json.dumps({
            "error": str(e),
            "skill": skill_name,
            "status": "error",
        })


def _execute_tool(
    tool_context: ToolContext,
    skill_name: str,
    tool_name: str,
    tool_input: dict,
) -> str:
    """Execute a tool (existing logic extracted for clarity)."""
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


def _dict_to_cli_args(params: dict) -> str:
    """Convert a dict to CLI argument string.

    Conversion rules:
      - key "fetch_url" or "fetch-url" → --fetch-url
      - bool True  → --flag (present)
      - bool False → omitted
      - list       → --key v1 --key v2
      - other      → --key 'value'
    """
    import shlex

    args = []
    for key, value in params.items():
        flag = "--" + key.replace("_", "-")

        if isinstance(value, bool):
            if value:
                args.append(flag)
        elif isinstance(value, list):
            for item in value:
                args.append(f"{flag} {shlex.quote(str(item))}")
        else:
            args.append(f"{flag} {shlex.quote(str(value))}")

    return " ".join(args)


def _execute_script(
    tool_context: ToolContext,
    skill_name: str,
    script_name: str,
    script_input: dict,
) -> str:
    """Execute a script from a skill's scripts/ directory using shell tool."""
    import os
    import sys
    from strands_tools.shell import shell

    try:
        # Get script info from registry
        script_info = _registry.get_script(skill_name, script_name)
        script_path = script_info["path"]

        logger.info(f"Executing script: {skill_name}/{script_name}")
        logger.debug(f"Script path: {script_path}")
        logger.debug(f"Script input: {script_input}")

        # Security: verify script is within skill directory
        skill_dir = os.path.join(_registry.skills_dir, skill_name)
        script_abs = os.path.abspath(script_path)
        skill_abs = os.path.abspath(skill_dir)

        if not script_abs.startswith(skill_abs):
            return json.dumps({
                "error": "Security violation: script outside skill directory",
                "status": "error",
            })

        # Build command based on file extension
        if script_name.endswith('.py'):
            cmd = f"{sys.executable} {script_path}"
        elif script_name.endswith('.sh'):
            cmd = f"/bin/bash {script_path}"
        else:
            return json.dumps({
                "error": f"Unsupported script type: {script_name}",
                "status": "error",
            })

        # Convert script_input dict to CLI arguments
        if script_input:
            cmd = cmd + " " + _dict_to_cli_args(script_input)

        # Get user context from invocation_state
        session_id = tool_context.invocation_state.get("session_id", "")
        user_id = tool_context.invocation_state.get("user_id", "")

        # Set environment variables via shell command
        env_vars = [
            f"SKILL_NAME={skill_name}",
            f"SCRIPT_NAME={script_name}",
        ]
        if session_id:
            env_vars.append(f"SESSION_ID={session_id}")
        if user_id:
            env_vars.append(f"USER_ID={user_id}")

        # Prepend env vars to command
        cmd = " ".join(env_vars) + " " + cmd

        logger.debug(f"Executing command: {cmd}")

        # Execute script with shell tool
        result = shell(
            command=cmd,
            work_dir=skill_dir,
            timeout=300,  # 5 minutes default
            non_interactive=True,  # Auto-execute without user prompt
        )

        # Parse result from shell tool
        # shell() returns dict with status and content
        if isinstance(result, dict):
            status = result.get("status", "error")
            content = result.get("content", [])

            # Extract text from content
            output_texts = []
            for item in content:
                if isinstance(item, dict) and "text" in item:
                    output_texts.append(item["text"])

            output = "\n".join(output_texts)

            logger.info(
                f"Script execution completed: {skill_name}/{script_name} "
                f"(status={status})"
            )

            return json.dumps({
                "status": status,
                "script": script_name,
                "output": output,
            })
        else:
            # Fallback: treat as string result
            return json.dumps({
                "status": "success",
                "script": script_name,
                "output": str(result),
            })

    except KeyError as e:
        return json.dumps({
            "error": str(e),
            "available_scripts": _registry.list_scripts(skill_name),
            "status": "error",
        })

    except Exception as e:
        logger.error(f"Script execution failed: {e}", exc_info=True)
        return json.dumps({
            "error": f"Script execution failed: {str(e)}",
            "status": "error",
        })
