"""
Stop Signal Provider

DynamoDB-based out-of-band stop signal for graceful agent cancellation.
Used with agent.cancel() from Strands SDK to trigger cooperative shutdown.

Usage:
    from agent.stop_signal import get_stop_signal_provider

    provider = get_stop_signal_provider()
    if provider and provider.is_stop_requested(user_id, session_id):
        agent.cancel()  # SDK handles graceful shutdown
"""

import os
import logging
from abc import ABC, abstractmethod
import threading

logger = logging.getLogger(__name__)


class StopSignalProvider(ABC):
    """Abstract base class for stop signal providers.

    Two-phase stop protocol:
      Phase 1: BFF writes stop signal → Main Agent detects and calls agent.cancel()
      Phase 2: Main Agent escalates → Code Agent detects and handles
    """

    @abstractmethod
    def is_stop_requested(self, user_id: str, session_id: str) -> bool:
        """Check if stop has been requested for this session (phase 1)"""
        pass

    @abstractmethod
    def request_stop(self, user_id: str, session_id: str) -> None:
        """Request stop for this session"""
        pass

    @abstractmethod
    def clear_stop_signal(self, user_id: str, session_id: str) -> None:
        """Clear stop signal after processing"""
        pass

    def escalate_to_code_agent(self, user_id: str, session_id: str) -> None:
        """Escalate stop signal from phase 1 to phase 2 (for Code Agent)."""
        pass


class DynamoDBStopSignalProvider(StopSignalProvider):
    """
    Cloud deployment: DynamoDB-based out-of-band stop signal.
    Bypasses AgentCore Runtime's single-request-per-session limitation
    by writing/reading stop flags directly to DynamoDB.
    """

    def __init__(self, table_name: str):
        import boto3
        self._table_name = table_name
        region = os.environ.get("AWS_REGION", "us-west-2")
        self._client = boto3.client("dynamodb", region_name=region)

    def _get_key(self, user_id: str, session_id: str) -> dict:
        return {
            "userId": {"S": f"STOP#{user_id}"},
            "sk": {"S": f"SESSION#{session_id}"},
        }

    def is_stop_requested(self, user_id: str, session_id: str) -> bool:
        """Check for phase 1 stop signal (Main Agent only)."""
        try:
            resp = self._client.get_item(
                TableName=self._table_name,
                Key=self._get_key(user_id, session_id),
                ProjectionExpression="phase",
            )
            item = resp.get("Item")
            if not item:
                return False
            phase = int(item.get("phase", {}).get("N", "0"))
            if phase == 1:
                logger.info(f"[StopSignal] Phase 1 stop detected for {user_id}:{session_id}")
                return True
            return False
        except Exception as e:
            logger.warning(f"[StopSignal] DynamoDB check failed: {e}")
            return False

    def request_stop(self, user_id: str, session_id: str) -> None:
        import time
        try:
            self._client.put_item(
                TableName=self._table_name,
                Item={
                    **self._get_key(user_id, session_id),
                    "phase": {"N": "1"},
                    "ttl": {"N": str(int(time.time()) + 300)},
                },
            )
            logger.info(f"[StopSignal] Phase 1 stop set for {user_id}:{session_id}")
        except Exception as e:
            logger.warning(f"[StopSignal] DynamoDB put failed: {e}")

    def escalate_to_code_agent(self, user_id: str, session_id: str) -> None:
        """Update stop signal from phase 1 → phase 2 (Code Agent can now detect it)."""
        try:
            self._client.update_item(
                TableName=self._table_name,
                Key=self._get_key(user_id, session_id),
                UpdateExpression="SET phase = :p",
                ExpressionAttributeValues={":p": {"N": "2"}},
            )
            logger.info(f"[StopSignal] Escalated to phase 2 for {user_id}:{session_id}")
        except Exception as e:
            logger.warning(f"[StopSignal] Phase escalation failed: {e}")

    def clear_stop_signal(self, user_id: str, session_id: str) -> None:
        try:
            self._client.delete_item(
                TableName=self._table_name,
                Key=self._get_key(user_id, session_id),
            )
            logger.info(f"[StopSignal] Stop signal cleared for {user_id}:{session_id}")
        except Exception as e:
            logger.warning(f"[StopSignal] DynamoDB delete failed: {e}")


# Singleton instance cache
_provider_instance: StopSignalProvider = None
_provider_lock = threading.Lock()


def get_stop_signal_provider() -> StopSignalProvider | None:
    """Factory function to get the DynamoDB-based StopSignalProvider.

    Returns None when DYNAMODB_USERS_TABLE is not set (stop feature disabled).
    """
    global _provider_instance

    if _provider_instance is None:
        with _provider_lock:
            if _provider_instance is None:
                table_name = os.environ.get("DYNAMODB_USERS_TABLE")
                if not table_name:
                    logger.info("[StopSignal] DYNAMODB_USERS_TABLE not set, stop signal disabled")
                    return None
                logger.info(f"[StopSignal] Using DynamoDB provider (table={table_name})")
                _provider_instance = DynamoDBStopSignalProvider(table_name)

    return _provider_instance
