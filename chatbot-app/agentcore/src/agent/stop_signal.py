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
    Factory function to get the appropriate StopSignalProvider

    Returns:
        LocalStopSignalProvider (in-memory) for both local and cloud deployments.

    Note:
        We always use in-memory provider because:
        1. AgentCore Runtime guarantees session affinity (same session → same container)
        2. Stop requests come through /invocations (same container as streaming)
        3. In-memory is instant (no DynamoDB polling delay or cost)
    """
    global _provider_instance

    if _provider_instance is None:
        with _provider_lock:
            if _provider_instance is None:
                _provider_instance = LocalStopSignalProvider()

    return _provider_instance
