"""Hook for prompt caching - adds cache point at end of last assistant message"""

import logging
from typing import Any
from strands.hooks import HookProvider, HookRegistry, BeforeModelCallEvent

logger = logging.getLogger(__name__)


class ConversationCachingHook(HookProvider):
    """Add a single cache point at the end of the last Assistant message.

    Cache point = "cache everything up to this point"
    - Works for pure conversation and agent loops with tools
    - Single cache point avoids duplicate write premiums (25% each)
    """

    def __init__(self, enabled: bool = True):
        self.enabled = enabled

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeModelCallEvent, self.add_conversation_cache_point)

    def add_conversation_cache_point(self, event: BeforeModelCallEvent) -> None:
        """Add single cache point at the end of the last Assistant message"""
        if not self.enabled:
            return

        messages = event.agent.messages
        if not messages:
            return

        # Find existing cache points and last assistant message
        cache_point_positions = []
        last_assistant_idx = None

        for msg_idx, msg in enumerate(messages):
            if msg.get("role") == "assistant":
                last_assistant_idx = msg_idx

            content = msg.get("content", [])
            if not isinstance(content, list):
                continue

            for block_idx, block in enumerate(content):
                if isinstance(block, dict) and "cachePoint" in block:
                    cache_point_positions.append((msg_idx, block_idx))

        if last_assistant_idx is None:
            return

        last_assistant_content = messages[last_assistant_idx].get("content", [])
        if not isinstance(last_assistant_content, list) or len(last_assistant_content) == 0:
            return

        # Check if cache point already at end
        last_block = last_assistant_content[-1]
        if isinstance(last_block, dict) and "cachePoint" in last_block:
            return

        # Remove old cache points (reverse order to avoid index shifting)
        for msg_idx, block_idx in reversed(cache_point_positions):
            msg_content = messages[msg_idx].get("content", [])
            if isinstance(msg_content, list) and block_idx < len(msg_content):
                del msg_content[block_idx]

        # Add cache point at end of last assistant message
        cache_block = {"cachePoint": {"type": "default"}}
        last_assistant_content = messages[last_assistant_idx].get("content", [])
        if isinstance(last_assistant_content, list):
            last_assistant_content.append(cache_block)
            logger.debug(f"Added cache point at assistant message {last_assistant_idx}")
