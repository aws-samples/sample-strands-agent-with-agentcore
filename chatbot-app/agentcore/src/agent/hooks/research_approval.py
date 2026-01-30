"""Hook for user approval using Strands Interrupts before executing A2A agents"""

import logging
import os
import json
import time
from typing import Any
from strands.hooks import HookProvider, HookRegistry, BeforeToolCallEvent

logger = logging.getLogger(__name__)

# Time window (in seconds) during which a recent approval is valid
APPROVAL_VALIDITY_WINDOW = 60  # 1 minute


class ResearchApprovalHook(HookProvider):
    """Request user approval via Strands Interrupts before executing A2A agents.

    Uses event.interrupt() to pause execution and wait for user confirmation.
    Also checks for recent approvals to auto-approve on retry after interrupt resume.
    """

    def __init__(self, app_name: str = "chatbot"):
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self.request_approval)

    def _check_recent_approval(self, session_id: str) -> bool:
        """Check if there's a recent approval for this session.
        
        This is used to auto-approve on retry after an interrupt was approved.
        The approval state is stored by ChatbotAgent._store_approval_state().
        
        Args:
            session_id: The session ID to check
            
        Returns:
            True if there's a recent approval, False otherwise
        """
        approval_key = f"APPROVAL_STATE_{session_id}"
        
        try:
            approval_json = os.environ.get(approval_key, "{}")
            approval_state = json.loads(approval_json)
            
            # Check if there's a recent approval
            last_approval = approval_state.get("_last_approval", False)
            last_approval_time = approval_state.get("_last_approval_time", 0)
            
            if last_approval and (time.time() - last_approval_time) < APPROVAL_VALIDITY_WINDOW:
                logger.info(f"✅ Found recent approval (within {APPROVAL_VALIDITY_WINDOW}s) - auto-approving")
                # Clear the approval state after using it (one-time use)
                del os.environ[approval_key]
                return True
                
        except (json.JSONDecodeError, KeyError) as e:
            logger.debug(f"No recent approval found: {e}")
            
        return False

    def request_approval(self, event: BeforeToolCallEvent) -> None:
        """Request user approval before executing A2A agent tools"""
        tool_name = event.tool_use.get("name", "")

        if tool_name not in ["research_agent", "browser_use_agent"]:
            return

        # Check for recent approval (from interrupt resume)
        session_id = os.environ.get("SESSION_ID", "")
        if session_id and self._check_recent_approval(session_id):
            logger.info(f"✅ Auto-approving {tool_name} based on recent user approval")
            return

        tool_input = event.tool_use.get("input", {})

        if tool_name == "research_agent":
            plan = tool_input.get("plan", "No plan provided")
            logger.info(f"🔍 Requesting approval for research_agent: {plan[:100]}...")

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
            logger.info(f"🌐 Requesting approval for browser_use_agent: {task[:100]}...")

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
            logger.info(f"✅ {action.capitalize()} approved by user")
            return
        else:
            logger.info(f"❌ {action.capitalize()} rejected by user")
            event.cancel_tool = f"User declined to proceed with {action}"
