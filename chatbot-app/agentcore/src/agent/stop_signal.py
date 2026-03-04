"""
Stop Signal Provider - Strategy Pattern

Provides unified stop signal mechanism for both local and cloud deployments.
- Local: In-memory dictionary (singleton)
- Cloud: DynamoDB session metadata

Usage:
    from agent.stop_signal import get_stop_signal_provider

    provider = get_stop_signal_provider()

    # Check if stop requested
    if provider.is_stop_requested(user_id, session_id):
        # Handle graceful shutdown
        provider.clear_stop_signal(user_id, session_id)

    # Request stop (called by BFF or API)
    provider.request_stop(user_id, session_id)
"""

import os
import logging
from abc import ABC, abstractmethod
from typing import Dict
import threading

logger = logging.getLogger(__name__)


class StopSignalProvider(ABC):
    """Abstract base class for stop signal providers.

    Two-phase stop protocol (cloud mode):
      Phase 1: BFF writes stop signal → Main Agent detects and handles
      Phase 2: Main Agent escalates → Code Agent detects and handles
    Local mode uses a simple boolean flag (no phases).
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
        """Escalate stop signal from phase 1 to phase 2 (for Code Agent).

        Default implementation is a no-op (local mode doesn't need phases).
        DynamoDB provider overrides this to update the phase attribute.
        """
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


class LocalStopSignalProvider(StopSignalProvider):
    """
    Local development: In-memory dictionary
    Thread-safe singleton for multi-threaded local server
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._signals: Dict[str, bool] = {}
                    cls._instance._signals_lock = threading.Lock()
        return cls._instance

    def _get_key(self, user_id: str, session_id: str) -> str:
        return f"{user_id}:{session_id}"

    def is_stop_requested(self, user_id: str, session_id: str) -> bool:
        key = self._get_key(user_id, session_id)
        with self._signals_lock:
            result = self._signals.get(key, False)
        if result:
            logger.debug(f"[StopSignal] Stop requested for {key}")
        return result

    def request_stop(self, user_id: str, session_id: str) -> None:
        key = self._get_key(user_id, session_id)
        with self._signals_lock:
            self._signals[key] = True
        logger.debug(f"Stop signal set for {key}")

    def clear_stop_signal(self, user_id: str, session_id: str) -> None:
        key = self._get_key(user_id, session_id)
        with self._signals_lock:
            self._signals.pop(key, None)
        logger.debug(f"Stop signal cleared for {key}")


# Singleton instance cache
_provider_instance: StopSignalProvider = None
_provider_lock = threading.Lock()


def get_stop_signal_provider() -> StopSignalProvider:
    """
    Factory function to get the appropriate StopSignalProvider.

    Returns:
        DynamoDBStopSignalProvider when DYNAMODB_USERS_TABLE is set (cloud mode).
        LocalStopSignalProvider (in-memory) otherwise (local mode).
    """
    global _provider_instance

    if _provider_instance is None:
        with _provider_lock:
            if _provider_instance is None:
                table_name = os.environ.get("DYNAMODB_USERS_TABLE")
                if table_name:
                    logger.info(f"[StopSignal] Using DynamoDB provider (table={table_name})")
                    _provider_instance = DynamoDBStopSignalProvider(table_name)
                else:
                    logger.info("[StopSignal] Using local in-memory provider")
                    _provider_instance = LocalStopSignalProvider()

    return _provider_instance
