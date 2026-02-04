"""Hook for user approval using Strands Interrupts before executing A2A agents"""

import logging
from typing import Any
from strands.hooks import HookProvider, HookRegistry, BeforeToolCallEvent

logger = logging.getLogger(__name__)


class ResearchApprovalHook(HookProvider):
    """Request user approval via Strands Interrupts before executing A2A agents.

    Uses event.interrupt() to pause execution and wait for user confirmation.
    """

    def __init__(self, app_name: str = "chatbot"):
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.request_approval)

    def request_approval(self, event: BeforeToolCallEvent) -> None:
        """Request user approval before executing A2A agent tools"""
        tool_name = event.tool_use.get("name", "")

        if tool_name not in ["research_agent", "browser_use_agent"]:
            return

        tool_input = event.tool_use.get("input", {})

        if tool_name == "research_agent":
            plan = tool_input.get("plan", "No plan provided")
            logger.debug(f"Requesting approval for research_agent")

            approval = event.interrupt(
                f"{self.app_name}-research-approval",
                reason={
                    "tool_name": tool_name,
                    "plan": plan,
                    "plan_preview": plan[:200] + "..." if len(plan) > 200 else plan
                }
            )
            action = "research"

        elif tool_name == "browser_use_agent":
            task = tool_input.get("task", "No task provided")
            logger.debug(f"Requesting approval for browser_use_agent")

            approval = event.interrupt(
                f"{self.app_name}-browser-approval",
                reason={
                    "tool_name": tool_name,
                    "task": task,
                    "task_preview": task[:200] + "..." if len(task) > 200 else task,
                }
            )
            action = "browser automation"

        if approval and approval.lower() in ["y", "yes", "approve", "approved"]:
            logger.debug(f"{action.capitalize()} approved by user")
            return
        else:
            logger.info(f"{action.capitalize()} rejected by user")
            event.cancel_tool = f"User declined to proceed with {action}"
