"""Exercise the real executor with the external Claude transport replaced."""
import asyncio
import importlib
import json
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest


@pytest.fixture
def main(monkeypatch, tmp_path):
    sdk = ModuleType('claude_agent_sdk')
    for name in ['ClaudeSDKClient', 'ClaudeAgentOptions', 'AssistantMessage', 'SystemMessage', 'ResultMessage', 'TextBlock', 'ToolUseBlock']:
        setattr(sdk, name, type(name, (), {}))
    for name in ['CLINotFoundError', 'CLIConnectionError', 'ProcessError', 'CLIJSONDecodeError']:
        setattr(sdk, name, type(name, (Exception,), {}))
    monkeypatch.setitem(sys.modules, 'claude_agent_sdk', sdk)
    monkeypatch.setenv('CODE_AGENT_MODEL_ID', 'us.anthropic.claude-sonnet-5')
    monkeypatch.setenv('ARTIFACT_BUCKET', 'test-bucket')
    sys.modules.pop('src.main', None)
    module = importlib.import_module('src.main')
    monkeypatch.setattr(module, 'ARTIFACT_BUCKET', '')
    monkeypatch.setattr(module, 'WORKSPACE_BASE', str(tmp_path))
    return module


@pytest.mark.asyncio
async def test_cancel_discards_old_transport_but_preserves_session_for_next_query(main, monkeypatch):
    old = SimpleNamespace(_query=object(), interrupt=AsyncMock(), disconnect=AsyncMock())
    fresh = SimpleNamespace(connect=AsyncMock())
    main._sdk_clients['user-session'] = old
    main._sdk_sessions['user-session'] = 'saved-conversation'
    main._task_to_sdk_key['task'] = 'user-session'
    event = asyncio.Event()
    main._cancel_events['task'] = event
    updater = SimpleNamespace(cancel=AsyncMock())
    monkeypatch.setattr(main, 'TaskUpdater', lambda *args: updater)
    monkeypatch.setattr(main, 'ClaudeSDKClient', lambda **kwargs: fresh)
    await main.ClaudeCodeExecutor().cancel(SimpleNamespace(task_id='task', context_id='context'), None)
    assert event.is_set()
    old.interrupt.assert_awaited_once()
    old.disconnect.assert_awaited_once()
    assert main._sdk_sessions['user-session'] == 'saved-conversation'
    assert await main._get_or_create_client('user-session', None, 'model') is fresh
    fresh.connect.assert_awaited_once()


def configure_query(main, monkeypatch, receive):
    client = SimpleNamespace(query=AsyncMock(), receive_messages=receive)
    monkeypatch.setattr(main, '_get_or_create_client', AsyncMock(return_value=client))
    monkeypatch.setattr(main, '_build_client_options', lambda *args, **kwargs: None)
    monkeypatch.setattr(main, '_extract_text', lambda _: 'Create a verified file')
    monkeypatch.setattr(main, '_extract_metadata', lambda _: {'user_id': 'user', 'session_id': 'session'})
    main._sdk_sessions['user-session'] = 'saved-conversation'
    sync = Mock()
    monkeypatch.setattr(main, 'sync_session', sync)
    updater = SimpleNamespace(submit=AsyncMock(), add_artifact=AsyncMock(), failed=AsyncMock(), complete=AsyncMock(), cancel=AsyncMock())
    return updater, sync


@pytest.mark.asyncio
async def test_empty_sdk_response_is_failure_not_success(main, monkeypatch):
    async def empty():
        if False:
            yield None
    updater, sync = configure_query(main, monkeypatch, empty)
    await main.ClaudeCodeExecutor()._execute_impl(SimpleNamespace(task_id='task'), None, updater, asyncio.Event())
    updater.failed.assert_awaited_once()
    updater.complete.assert_not_awaited()
    payload = json.loads(updater.add_artifact.call_args.args[0][0].root.text)
    assert payload['status'] == 'error'
    assert payload['summary'].startswith('Error:')
    sync.assert_called_once()


@pytest.mark.asyncio
async def test_framework_cancellation_still_saves_existing_workspace(main, monkeypatch):
    entered = asyncio.Event()
    async def blocked():
        entered.set()
        await asyncio.Event().wait()
        yield None
    updater, sync = configure_query(main, monkeypatch, blocked)
    task = asyncio.create_task(main.ClaudeCodeExecutor()._execute_impl(SimpleNamespace(task_id='task'), None, updater, asyncio.Event()))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    sync.assert_called_once()
    updater.complete.assert_not_awaited()


def test_client_keeps_commands_attached_without_losing_resume_options(main, monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'ClaudeAgentOptions', lambda **kwargs: SimpleNamespace(**kwargs))
    options = main._build_client_options('saved-session', tmp_path, max_turns=12, model_id='chosen-model')
    assert options.env['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'] == '1'
    assert options.system_prompt['preset'] == 'claude_code'
    assert 'finite commands' in options.system_prompt['append']
    assert options.resume == 'saved-session'
    assert options.cwd == str(tmp_path)
    assert options.max_turns == 12
    assert options.model == 'chosen-model'


def test_opus_options_use_mantle_without_changing_process_environment(main, monkeypatch):
    monkeypatch.setenv('CLAUDE_CODE_USE_BEDROCK', '1')
    monkeypatch.setattr(main, 'ClaudeAgentOptions', lambda **kwargs: SimpleNamespace(**kwargs))
    options = main._build_client_options(model_id='anthropic.claude-opus-5-5')
    assert options.env['CLAUDE_CODE_USE_BEDROCK'] == '1'
    assert options.env['CLAUDE_CODE_USE_MANTLE'] == '1'
    assert options.env['AWS_REGION'] == 'us-east-1'
    assert main.os.environ['CLAUDE_CODE_USE_BEDROCK'] == '1'
    assert 'CLAUDE_CODE_USE_MANTLE' not in main._model_environment('us.anthropic.claude-sonnet-5')


@pytest.mark.asyncio
@pytest.mark.parametrize(('previous', 'requested'), [
    ('us.anthropic.claude-sonnet-5', 'anthropic.claude-opus-5-5'),
    ('anthropic.claude-opus-5-5', 'us.anthropic.claude-sonnet-5'),
])
async def test_backend_switch_recreates_the_claude_subprocess(main, monkeypatch, previous, requested):
    old = SimpleNamespace(_query=object(), disconnect=AsyncMock(), set_model=AsyncMock())
    fresh = SimpleNamespace(connect=AsyncMock())
    main._sdk_clients['switch-session'] = old
    main._sdk_client_models['switch-session'] = previous
    monkeypatch.setattr(main, 'ClaudeSDKClient', lambda **kwargs: fresh)
    assert await main._get_or_create_client('switch-session', None, requested) is fresh
    old.set_model.assert_not_awaited()
    old.disconnect.assert_awaited_once()
    fresh.connect.assert_awaited_once()
