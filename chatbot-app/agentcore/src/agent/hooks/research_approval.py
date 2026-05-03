"""Hook for user approval using Strands Interrupts before executing A2A agents"""

import logging
from typing import Any
from strands.hooks import HookProvider, HookRegistry, BeforeToolCallEvent

logger = logging.getLogger(__name__)


class ResearchApprovalHook(HookProvider):
    """Request user approval via Strands Interrupts before executing A2A agents.

    Uses event.interrupt() to pause execution and wait for user confirmation.
    Handles both direct tool calls (research_agent) and skill_executor calls
    that target research_agent.
    """

    def __init__(self, app_name: str = "chatbot"):
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.request_approval)

    def request_approval(self, event: BeforeToolCallEvent) -> None:
        """Request user approval before executing A2A agent tools"""
        tool_name = event.tool_use.get("name", "")
        tool_input = event.tool_use.get("input", {})

        if tool_name == "skill_executor":
            actual_tool = tool_input.get("tool_name", "")
            if actual_tool != "research_agent":
                return
            inner = tool_input.get("tool_input", {})
            if isinstance(inner, str):
                import json
                try:
                    inner = json.loads(inner)
                except (json.JSONDecodeError, TypeError):
                    inner = {}
            plan = inner.get("plan", "No plan provided") if isinstance(inner, dict) else "No plan provided"
        elif tool_name == "research_agent":
            plan = tool_input.get("plan", "No plan provided")
        else:
            return

        logger.debug(f"Requesting approval for research_agent")

        approval = event.interrupt(
            f"{self.app_name}-research-approval",
            reason={
                "tool_name": "research_agent",
                "plan": plan,
                "plan_preview": plan[:200] + "..." if len(plan) > 200 else plan
            }
        )

        if approval and approval.lower() in ["y", "yes", "approve", "approved"]:
            logger.debug("Research approved by user")
            return
        else:
            logger.info("Research rejected by user")
            event.cancel_tool = "User declined to proceed with research"
