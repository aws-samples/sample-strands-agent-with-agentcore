"""
OAuth Elicitation Bridge

Bridge between MCP elicitation callback (MCPClient) and SSE stream (StreamEventProcessor).
When an MCP tool calls ctx.elicit_url(), the MCPClient's elicitation_callback fires.
This bridge:
1. Pushes an event to the outbound queue (SSE stream picks it up)
2. Waits for the frontend to signal completion via REST endpoint
3. Returns the result to the MCPClient so the tool can resume
"""

import asyncio
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)


class OAuthElicitationBridge:
    """Bridge between MCP elicitation callback and SSE stream."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self._outbound_queue: asyncio.Queue = asyncio.Queue()
        self._completion_events: dict[str, asyncio.Event] = {}

    async def elicitation_callback(self, context, params) -> Any:
        """MCPClient elicitation callback.

        Called by Strands MCPClient when the MCP server requests elicitation.
        Pushes event to SSE stream and waits for frontend completion signal.
        """
        from mcp.types import ElicitResult, ErrorData

        # Only handle URL elicitation (OAuth consent)
        if not hasattr(params, 'url'):
            return ElicitResult(action="decline")

        elicitation_id = getattr(params, 'elicitationId', str(id(params)))
        auth_url = params.url
        message = getattr(params, 'message', '')

        # Create completion event for this elicitation
        completion_event = asyncio.Event()
        self._completion_events[elicitation_id] = completion_event

        # Push to outbound queue (StreamEventProcessor will emit as SSE)
        await self._outbound_queue.put({
            "type": "oauth_elicitation",
            "auth_url": auth_url,
            "message": message,
            "elicitation_id": elicitation_id,
            "session_id": self.session_id,
        })

        logger.info(f"[Elicitation] Waiting for OAuth completion: {elicitation_id}")

        try:
            # Wait for frontend to signal completion (timeout: 5 min)
            await asyncio.wait_for(completion_event.wait(), timeout=300)
            logger.info(f"[Elicitation] OAuth completed: {elicitation_id}")
            return ElicitResult(action="accept")
        except asyncio.TimeoutError:
            logger.warning(f"[Elicitation] Timeout waiting for OAuth: {elicitation_id}")
            return ElicitResult(action="cancel")
        finally:
            self._completion_events.pop(elicitation_id, None)

    def complete_elicitation(self, elicitation_id: Optional[str] = None):
        """Signal that OAuth consent is complete. Called by REST endpoint."""
        if elicitation_id and elicitation_id in self._completion_events:
            self._completion_events[elicitation_id].set()
        else:
            # If no specific ID, complete all pending
            for event in self._completion_events.values():
                event.set()

    def get_pending_event_nowait(self):
        """Non-blocking check for pending elicitation events."""
        try:
            return self._outbound_queue.get_nowait()
        except asyncio.QueueEmpty:
            return None


# ── Module-level bridge registry ──────────────────────────────────────────
# Per-session bridges so chat.py can look up the bridge for completion signals.

_elicitation_bridges: dict[str, OAuthElicitationBridge] = {}


def register_bridge(session_id: str, bridge: OAuthElicitationBridge):
    _elicitation_bridges[session_id] = bridge


def get_bridge(session_id: str) -> Optional[OAuthElicitationBridge]:
    return _elicitation_bridges.get(session_id)


def cleanup_bridge(session_id: str):
    _elicitation_bridges.pop(session_id, None)
