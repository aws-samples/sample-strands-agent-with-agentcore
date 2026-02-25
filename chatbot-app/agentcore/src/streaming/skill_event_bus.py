"""Side-channel queue for skill executor streaming events.

skill_executor runs in a ThreadPoolExecutor (via _run_async), so it cannot
put items onto an asyncio.Queue directly.  stdlib queue.Queue is thread-safe
and works across event-loop boundaries.
"""
import queue
from typing import Optional

_queues: dict[str, queue.Queue] = {}


def get_or_create_queue(session_id: str) -> queue.Queue:
    if session_id not in _queues:
        _queues[session_id] = queue.Queue()
    return _queues[session_id]


def get_queue(session_id: str) -> Optional[queue.Queue]:
    return _queues.get(session_id)


def remove_queue(session_id: str) -> None:
    _queues.pop(session_id, None)
