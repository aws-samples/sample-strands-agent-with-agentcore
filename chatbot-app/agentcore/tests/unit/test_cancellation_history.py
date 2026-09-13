import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from agent.session.cancellation_history import CancellationHistory, STOPPED_TEXT, prepare_message
from agent.session.unified_file_session_manager import UnifiedFileSessionManager
from streaming.agui_event_processor import AGUIStreamEventProcessor


def test_partial_response_survives_file_history_reload(tmp_path):
    manager = UnifiedFileSessionManager(session_id='cancel-test', storage_dir=str(tmp_path))
    agent = SimpleNamespace(agent_id='default', _cancellation_history=CancellationHistory('Keep this text', True))
    # Real file persistence: same append path used by SDK MessageAddedEvent.
    manager._latest_agent_message['default'] = None
    manager.append_message({'role': 'assistant', 'content': [{'text': 'Cancelled by user'}]}, agent)
    restored = manager.list_messages('cancel-test', 'default')
    assert restored[0].message['content'] == [{'text': f'Keep this text\n\n{STOPPED_TEXT}'}]
    assert agent._cancellation_history.persisted


def test_completed_segments_are_not_repeated_after_tool_cancel():
    agent = SimpleNamespace(_cancellation_history=CancellationHistory('I will check that.'))
    complete = {'role': 'assistant', 'content': [{'text': 'I will check that.'}, {'toolUse': {'name': 'search'}}]}
    assert prepare_message(complete, agent) is complete
    agent._cancellation_history.requested = True
    placeholder = {'role': 'assistant', 'content': [{'text': 'Cancelled by user'}]}
    assert prepare_message(placeholder, agent)['content'] == [{'text': STOPPED_TEXT}]


def test_literal_cancellation_phrase_without_stop_is_untouched():
    agent = SimpleNamespace(_cancellation_history=CancellationHistory('Other text'))
    message = {'role': 'assistant', 'content': [{'text': 'Cancelled by user'}]}
    assert prepare_message(message, agent)['content'] == [{'text': 'Cancelled by user'}]


@pytest.mark.asyncio
async def test_tool_cancellation_persists_marker_and_emits_stopped():
    class Agent:
        def __init__(self):
            self.messages = [{'role': 'user', 'content': [{'toolResult': {'status': 'error'}}]}]
            self.session_manager = Mock()

        async def stream_async(self, *args, **kwargs):
            yield {'result': SimpleNamespace(stop_reason='cancelled')}

    agent = Agent()
    processor = AGUIStreamEventProcessor(thread_id='thread', run_id='run')
    processor._check_stop_signal = lambda: False
    chunks = [chunk async for chunk in processor.process_stream(agent, 'hello')]
    assert processor.was_cancelled
    assert 'stream_stopped' in ''.join(chunks)
    agent.session_manager.append_message.assert_called_once_with(
        {'role': 'assistant', 'content': [{'text': STOPPED_TEXT}]}, agent,
    )
    # A duplicate terminal event cannot append another marker.
    processor._fix_cancelled_history(agent)
    assert agent.session_manager.append_message.call_count == 1
