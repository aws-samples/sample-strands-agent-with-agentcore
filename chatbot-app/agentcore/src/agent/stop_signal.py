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
    """Abstract base class for stop signal providers"""

    @abstractmethod
    def is_stop_requested(self, user_id: str, session_id: str) -> bool:
        """Check if stop has been requested for this session"""
        pass

    @abstractmethod
    def request_stop(self, user_id: str, session_id: str) -> None:
        """Request stop for this session"""
        pass

    @abstractmethod
    def clear_stop_signal(self, user_id: str, session_id: str) -> None:
        """Clear stop signal after processing"""
        pass


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
        logger.info(f"[StopSignal] Stop signal set for {key}")

    def clear_stop_signal(self, user_id: str, session_id: str) -> None:
        key = self._get_key(user_id, session_id)
        with self._signals_lock:
            self._signals.pop(key, None)
        logger.info(f"[StopSignal] Stop signal cleared for {key}")


class DynamoDBStopSignalProvider(StopSignalProvider):
    """
    Cloud deployment: DynamoDB session metadata
    Uses {PROJECT_NAME}-users-v2 table, SESSION# records
    """

    def __init__(self, table_name: str, region: str = 'us-west-2'):
        self.table_name = table_name
        self.region = region
        self._dynamodb = None
        self._table = None

    def _get_table(self):
        """Lazy initialization of DynamoDB table"""
        if self._table is None:
            import boto3
            self._dynamodb = boto3.resource('dynamodb', region_name=self.region)
            self._table = self._dynamodb.Table(self.table_name)
        return self._table

    def _get_key(self, user_id: str, session_id: str) -> dict:
        """
        DynamoDB key structure matches frontend schema:
        - userId: user_id
        - sk: SESSION#{session_id}
        """
        return {
            'userId': user_id,
            'sk': f'SESSION#{session_id}'
        }

    def is_stop_requested(self, user_id: str, session_id: str) -> bool:
        try:
            table = self._get_table()
            key = self._get_key(user_id, session_id)

            response = table.get_item(
                Key=key,
                ProjectionExpression='stopRequested'
            )

            if 'Item' in response:
                result = response['Item'].get('stopRequested', False)
                if result:
                    logger.info(f"[StopSignal] ✅ Stop requested - table: {self.table_name}, key: {key}")
                return bool(result)
            return False

        except Exception as e:
            logger.warning(f"[StopSignal] Error checking stop signal: {e}")
            return False

    def request_stop(self, user_id: str, session_id: str) -> None:
        try:
            table = self._get_table()
            table.update_item(
                Key=self._get_key(user_id, session_id),
                UpdateExpression='SET stopRequested = :val, stopRequestedAt = :ts',
                ExpressionAttributeValues={
                    ':val': True,
                    ':ts': self._get_timestamp()
                }
            )
            logger.info(f"[StopSignal] Stop signal set for {user_id}:{session_id}")

        except Exception as e:
            logger.error(f"[StopSignal] Error setting stop signal: {e}")
            raise

    def clear_stop_signal(self, user_id: str, session_id: str) -> None:
        try:
            table = self._get_table()
            table.update_item(
                Key=self._get_key(user_id, session_id),
                UpdateExpression='REMOVE stopRequested, stopRequestedAt'
            )
            logger.info(f"[StopSignal] Stop signal cleared for {user_id}:{session_id}")

        except Exception as e:
            logger.warning(f"[StopSignal] Error clearing stop signal: {e}")

    def _get_timestamp(self) -> str:
        from datetime import datetime
        return datetime.utcnow().isoformat() + 'Z'


# Singleton instance cache
_provider_instance: StopSignalProvider = None
_provider_lock = threading.Lock()


def get_stop_signal_provider() -> StopSignalProvider:
    """
    Factory function to get the appropriate StopSignalProvider

    Returns:
        LocalStopSignalProvider for local development
        DynamoDBStopSignalProvider for cloud deployment
    """
    global _provider_instance

    if _provider_instance is None:
        with _provider_lock:
            if _provider_instance is None:
                is_local = os.environ.get('NEXT_PUBLIC_AGENTCORE_LOCAL', 'false').lower() == 'true'
                logger.info(f"[StopSignal] NEXT_PUBLIC_AGENTCORE_LOCAL={os.environ.get('NEXT_PUBLIC_AGENTCORE_LOCAL', 'not set')}")

                if is_local:
                    logger.info("[StopSignal] Using LocalStopSignalProvider (in-memory)")
                    _provider_instance = LocalStopSignalProvider()
                else:
                    project_name = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
                    table_name = f"{project_name}-users-v2"
                    region = os.environ.get('AWS_REGION', 'us-west-2')
                    logger.info(f"[StopSignal] Using DynamoDBStopSignalProvider")
                    logger.info(f"[StopSignal]   PROJECT_NAME={project_name}")
                    logger.info(f"[StopSignal]   Table: {table_name}")
                    logger.info(f"[StopSignal]   Region: {region}")
                    _provider_instance = DynamoDBStopSignalProvider(table_name, region)

    return _provider_instance
