"""Hook for user approval before bulk email deletion using Strands Interrupts"""

import logging
from typing import Any
from strands.hooks import HookProvider, HookRegistry, BeforeToolCallEvent
from agent.hooks.utils import resolve_tool_call

logger = logging.getLogger(__name__)


class EmailApprovalHook(HookProvider):
    """Request user approval via Strands Interrupts before bulk email operations.

    Uses event.interrupt() to pause execution and wait for user confirmation.
    The tool's 'reason' parameter is shown to help users understand the intent.
    """

    def __init__(self, app_name: str = "chatbot"):
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.request_approval)

    def request_approval(self, event: BeforeToolCallEvent) -> None:
        """Request user approval before executing bulk email deletion"""
        tool_name, tool_input = resolve_tool_call(event)

        if tool_name != "bulk_delete_emails":
            return
        query = tool_input.get("query", "")
        reason = tool_input.get("reason", "No reason provided")
        max_delete = tool_input.get("max_delete", 50)

        logger.debug(f"Requesting approval for bulk_delete_emails: query={query}")

        approval = event.interrupt(
            f"{self.app_name}-email-delete-approval",
            reason={
                "tool_name": tool_name,
                "query": query,
                "intent": reason,
                "max_delete": max_delete,
                "warning": "This will PERMANENTLY delete emails. They cannot be recovered.",
            }
        )

        if approval and approval.lower() in ["y", "yes", "approve", "approved"]:
            logger.debug("Bulk email deletion approved by user")
            return
        else:
            logger.info("Bulk email deletion rejected by user")
            event.cancel_tool = "User declined bulk email deletion"
