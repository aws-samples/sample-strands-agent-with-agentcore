from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from a2a.types import TaskIdParams

import a2a_tools


@pytest.mark.asyncio
async def test_closing_tool_stream_cancels_remote_task_with_sdk_request(monkeypatch):
    async def messages(_message):
        yield SimpleNamespace(id='remote-task'), None

    client = SimpleNamespace(send_message=messages, cancel_task=AsyncMock())
    http = SimpleNamespace(headers={}, aclose=AsyncMock())
    monkeypatch.setenv('LOCAL_CODE_AGENT_URL', 'https://example.test')
    monkeypatch.setattr(a2a_tools, 'get_http_client', lambda *a, **k: http)
    monkeypatch.setattr(a2a_tools, 'ClientFactory', lambda _: SimpleNamespace(create=lambda _: client))
    stream = a2a_tools.send_a2a_message('code-agent', 'Wait then create a file', session_id='session-' + 'a' * 40)
    first = await anext(stream)
    assert first == {'type': 'a2a_task_started', 'taskId': 'remote-task'}
    await stream.aclose()
    client.cancel_task.assert_awaited_once()
    request = client.cancel_task.call_args.args[0]
    assert isinstance(request, TaskIdParams)
    assert request.id == 'remote-task'
    http.aclose.assert_awaited_once()

@pytest.mark.asyncio
async def test_interrupting_pending_remote_read_still_delivers_cancel(monkeypatch):
    import asyncio
    waiting = asyncio.Event()

    async def messages(_message):
        yield SimpleNamespace(id='remote-running', status=SimpleNamespace(state='working')), None
        waiting.set()
        await asyncio.Event().wait()

    client = SimpleNamespace(send_message=messages, cancel_task=AsyncMock())
    http = SimpleNamespace(headers={}, aclose=AsyncMock())
    monkeypatch.setenv('LOCAL_CODE_AGENT_URL', 'https://example.test')
    monkeypatch.setattr(a2a_tools, 'get_http_client', lambda *a, **k: http)
    monkeypatch.setattr(a2a_tools, 'ClientFactory', lambda _: SimpleNamespace(create=lambda _: client))
    stream = a2a_tools.send_a2a_message('code-agent', 'Wait', session_id='session-' + 'b' * 40)
    await anext(stream)
    pending = asyncio.create_task(anext(stream))
    await waiting.wait()
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert client.cancel_task.call_args.args[0].id == 'remote-running'
    http.aclose.assert_awaited_once()
