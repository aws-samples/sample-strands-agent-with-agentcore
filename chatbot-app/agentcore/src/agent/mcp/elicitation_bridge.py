"""
OAuth Elicitation Bridge

Bridge between MCP elicitation callback (MCPClient) and SSE stream (StreamEventProcessor).
When an MCP tool calls ctx.elicit_url(), the MCPClient's elicitation_callback fires.
This bridge:
1. Pushes an event to the outbound queue (SSE stream picks it up)
2. Waits for the frontend to signal completion via shared store (DynamoDB or in-memory)
3. Returns the result to the MCPClient so the tool can resume

Cloud mode uses DynamoDB for cross-container signaling (same pattern as StopSignalProvider).
Local mode uses in-memory threading.Event for simplicity.
"""

import asyncio
import logging
import os
import threading
import time
from typing import Optional, Any

logger = logging.getLogger(__name__)

# Polling interval for completion check (seconds)
_POLL_INTERVAL = 1.0
# Maximum wait time for OAuth completion (seconds)
_MAX_WAIT = 300


class OAuthElicitationBridge:
    """Bridge between MCP elicitation callback and SSE stream."""

    def __init__(self, session_id: str, user_id: str = "anonymous"):
        self.session_id = session_id
        self.user_id = user_id
        self._outbound_queue: asyncio.Queue = asyncio.Queue()

    async def elicitation_callback(self, context, params) -> Any:
        """MCPClient elicitation callback.

        Called by Strands MCPClient when the MCP server requests elicitation.
        Pushes event to SSE stream and polls shared store for completion signal.
        """
        from mcp.types import ElicitResult

        if not hasattr(params, 'url'):
            return ElicitResult(action="decline")

        elicitation_id = getattr(params, 'elicitationId', str(id(params)))
        auth_url = params.url
        message = getattr(params, 'message', '')

        # Push to outbound queue (StreamEventProcessor will emit as SSE)
        await self._outbound_queue.put({
            "type": "oauth_elicitation",
            "auth_url": auth_url,
            "message": message,
            "elicitation_id": elicitation_id,
            "session_id": self.session_id,
        })

        logger.info(f"[Elicitation] Waiting for OAuth completion: {elicitation_id}")

        # Poll shared store for completion (runs in executor to avoid blocking event loop)
        loop = asyncio.get_running_loop()
        store = _get_elicitation_store()

        try:
            completed = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    _poll_for_completion,
                    store, self.session_id, elicitation_id,
                ),
                timeout=_MAX_WAIT + 5,
            )
            if completed:
                logger.info(f"[Elicitation] OAuth completed: {elicitation_id}")
                store.clear(self.session_id, elicitation_id)
                return ElicitResult(action="accept")
            else:
                logger.warning(f"[Elicitation] Timeout waiting for OAuth: {elicitation_id}")
                store.clear(self.session_id, elicitation_id)
                return ElicitResult(action="cancel")
        except asyncio.TimeoutError:
            logger.warning(f"[Elicitation] Timeout waiting for OAuth: {elicitation_id}")
            store.clear(self.session_id, elicitation_id)
            return ElicitResult(action="cancel")

    def get_pending_event_nowait(self):
        """Non-blocking check for pending elicitation events."""
        try:
            return self._outbound_queue.get_nowait()
        except asyncio.QueueEmpty:
            return None


def _poll_for_completion(
    store: "ElicitationStore",
    session_id: str,
    elicitation_id: str,
) -> bool:
    """Blocking poll for completion signal. Runs in thread pool executor."""
    deadline = time.monotonic() + _MAX_WAIT
    while time.monotonic() < deadline:
        if store.is_completed(session_id, elicitation_id):
            return True
        time.sleep(_POLL_INTERVAL)
    return False


# ── Completion signal store (DynamoDB or in-memory) ──────────────────────


class ElicitationStore:
    """Abstract store for elicitation completion signals."""

    def signal_complete(self, session_id: str, elicitation_id: Optional[str]) -> None:
        raise NotImplementedError

    def is_completed(self, session_id: str, elicitation_id: str) -> bool:
        raise NotImplementedError

    def clear(self, session_id: str, elicitation_id: str) -> None:
        raise NotImplementedError


class DynamoDBElicitationStore(ElicitationStore):
    """Cloud: DynamoDB-backed completion signals (cross-container safe)."""

    def __init__(self, table_name: str):
        import boto3
        region = os.environ.get("AWS_REGION", "us-west-2")
        self._client = boto3.client("dynamodb", region_name=region)
        self._table_name = table_name

    def _get_key(self, session_id: str, elicitation_id: str) -> dict:
        return {
            "userId": {"S": f"ELICIT#{session_id}"},
            "sk": {"S": f"EID#{elicitation_id}"},
        }

    def signal_complete(self, session_id: str, elicitation_id: Optional[str]) -> None:
        eid = elicitation_id or "__all__"
        try:
            self._client.put_item(
                TableName=self._table_name,
                Item={
                    **self._get_key(session_id, eid),
                    "status": {"S": "completed"},
                    "ttl": {"N": str(int(time.time()) + 600)},
                },
            )
            logger.info(f"[Elicitation] Completion signalled in DynamoDB: {session_id}/{eid}")
        except Exception as e:
            logger.error(f"[Elicitation] DynamoDB put failed: {e}")

    def is_completed(self, session_id: str, elicitation_id: str) -> bool:
        try:
            # Check specific elicitation ID
            resp = self._client.get_item(
                TableName=self._table_name,
                Key=self._get_key(session_id, elicitation_id),
                ProjectionExpression="#s",
                ExpressionAttributeNames={"#s": "status"},
            )
            if resp.get("Item"):
                return True
            # Check wildcard completion
            resp = self._client.get_item(
                TableName=self._table_name,
                Key=self._get_key(session_id, "__all__"),
                ProjectionExpression="#s",
                ExpressionAttributeNames={"#s": "status"},
            )
            return bool(resp.get("Item"))
        except Exception as e:
            logger.warning(f"[Elicitation] DynamoDB check failed: {e}")
            return False

    def clear(self, session_id: str, elicitation_id: str) -> None:
        try:
            self._client.delete_item(
                TableName=self._table_name,
                Key=self._get_key(session_id, elicitation_id),
            )
            self._client.delete_item(
                TableName=self._table_name,
                Key=self._get_key(session_id, "__all__"),
            )
        except Exception:
            pass


class LocalElicitationStore(ElicitationStore):
    """Local: in-memory store (single process)."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._completed: dict[str, bool] = {}
                    cls._instance._data_lock = threading.Lock()
        return cls._instance

    def _key(self, session_id: str, elicitation_id: str) -> str:
        return f"{session_id}:{elicitation_id}"

    def signal_complete(self, session_id: str, elicitation_id: Optional[str]) -> None:
        eid = elicitation_id or "__all__"
        with self._data_lock:
            self._completed[self._key(session_id, eid)] = True
        logger.info(f"[Elicitation] Completion signalled (local): {session_id}/{eid}")

    def is_completed(self, session_id: str, elicitation_id: str) -> bool:
        with self._data_lock:
            if self._completed.get(self._key(session_id, elicitation_id)):
                return True
            if self._completed.get(self._key(session_id, "__all__")):
                return True
        return False

    def clear(self, session_id: str, elicitation_id: str) -> None:
        with self._data_lock:
            self._completed.pop(self._key(session_id, elicitation_id), None)
            self._completed.pop(self._key(session_id, "__all__"), None)


# ── Singleton store ──────────────────────────────────────────────────────

_store_instance: Optional[ElicitationStore] = None
_store_lock = threading.Lock()


def _get_elicitation_store() -> ElicitationStore:
    global _store_instance
    if _store_instance is None:
        with _store_lock:
            if _store_instance is None:
                table_name = os.environ.get("DYNAMODB_USERS_TABLE")
                if table_name:
                    logger.info(f"[Elicitation] Using DynamoDB store (table={table_name})")
                    _store_instance = DynamoDBElicitationStore(table_name)
                else:
                    logger.info("[Elicitation] Using local in-memory store")
                    _store_instance = LocalElicitationStore()
    return _store_instance


# ── Public API for chat.py route handler ─────────────────────────────────

def signal_elicitation_complete(session_id: str, elicitation_id: Optional[str] = None) -> None:
    """Write completion signal to shared store. Called by /invocations handler."""
    store = _get_elicitation_store()
    store.signal_complete(session_id, elicitation_id)


# ── Bridge registry (for outbound queue access by event processor) ───────

_elicitation_bridges: dict[str, OAuthElicitationBridge] = {}


def register_bridge(session_id: str, bridge: OAuthElicitationBridge):
    _elicitation_bridges[session_id] = bridge


def get_bridge(session_id: str) -> Optional[OAuthElicitationBridge]:
    return _elicitation_bridges.get(session_id)


def cleanup_bridge(session_id: str):
    _elicitation_bridges.pop(session_id, None)
