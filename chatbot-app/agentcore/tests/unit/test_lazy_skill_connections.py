"""Remote discovery is deferred, scoped to the calling agent, and safe to retry."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from strands.types.collections import PaginatedList

from agent.stop_signal import clear_local_stop_event, signal_local_stop
from agent.tool_filter import FilteredToolResult
from agents.base import BaseAgent
from agents.chat_agent import ChatAgent
from agents.skill_chat_agent import SkillChatAgent
from skill import skill_tools


class Client:
    def __init__(self, owner, names):
        self.start, self.stop = Mock(), Mock()
        self.call_tool_sync = Mock(return_value={'content': [{'text': owner}]})
        self.tools = [SimpleNamespace(tool_name=name, mcp_tool=SimpleNamespace(name=name),
            mcp_client=self, tool_spec={'description': owner, 'inputSchema': {'json': {'type': 'object'}}}) for name in names]
        self.list_tools_sync = Mock(return_value=PaginatedList(self.tools))


@pytest.fixture
def make_agent(monkeypatch, tmp_path):
    for name in ('weather', 'gmail', 'github', 'local', 'bundle'):
        path = tmp_path / name
        path.mkdir()
        extra = 'type: composite\ncompose:\n  - weather\n  - gmail\n' if name == 'bundle' else ''
        (path / 'SKILL.md').write_text(f'---\nname: {name}\ndescription: {name} tools\n{extra}---\nUse {name}.\n')
    import agents.skill_chat_agent as module
    import agents.chat_agent as chat_module
    monkeypatch.setattr(module, '_SKILLS_DIR', str(tmp_path))
    monkeypatch.setattr(module, 'get_tool_to_skill_map', lambda: {'forecast': 'weather', 'read_mail': 'gmail', 'get_repo': 'github'})
    monkeypatch.setattr(module, 'get_mcp_runtime_skills', lambda: {'gmail', 'github'})
    monkeypatch.setattr(module, 'get_a2a_skill_tools', lambda: {})
    monkeypatch.setattr(chat_module, 'TOOL_REGISTRY', {})
    monkeypatch.setattr(BaseAgent, '_create_session_manager', lambda self: None)
    monkeypatch.setattr(ChatAgent, 'create_agent', lambda self: setattr(self, 'agent', SimpleNamespace(tool_registry=SimpleNamespace(registry={}))))
    clients = {}

    def filter_tools(**kwargs):
        gateway, federated = clients[kwargs['user_id']]
        result = FilteredToolResult()
        for prefix, name, client in [('gateway_', 'gateway', gateway), ('mcp_', 'mcp', federated)]:
            if any(t.startswith(prefix) for t in kwargs['enabled_tool_ids']):
                result.tools.append(client)
                result.clients[name] = client
        return result

    monkeypatch.setattr('agents.base.filter_tools', filter_tools)
    agents = []
    def make(owner='alice', **kwargs):
        gateway = Client(owner, ['service___forecast'])
        federated = Client(owner, ['read_mail', 'get_repo', 'unexpected_tool'])
        clients[owner] = gateway, federated
        agent = SkillChatAgent(session_id=f'session-{owner}', user_id=owner,
                               auth_token=kwargs.pop('auth_token', f'Bearer {owner}'), **kwargs)
        agents.append(agent)
        return agent, gateway, federated
    yield make
    for agent in agents:
        agent.close()


def context(agent, run='run-1'):
    return SimpleNamespace(agent=agent.agent, tool_use={'toolUseId': 'tool-1'}, invocation_state={
        'user_id': agent.user_id, 'session_id': agent.session_id, 'run_id': run})


def dispatch(agent, name, run='run-1'):
    return json.loads(skill_tools.skill_dispatcher(skill_name=name, tool_context=context(agent, run)))


def test_catalog_and_local_instructions_do_not_connect(make_agent):
    agent, gateway, federated = make_agent()
    assert 'gmail' in agent._skill_registry.get_catalog()
    assert dispatch(agent, 'local')['status'] == 'activated'
    agent.close()
    for client in (gateway, federated):
        client.start.assert_not_called()
        client.list_tools_sync.assert_not_called()


def test_only_selected_provider_connects_and_shared_skills_reuse_it(make_agent):
    agent, gateway, federated = make_agent()
    assert dispatch(agent, 'weather')['available_tools'][0]['name'] == 'forecast'
    gateway.start.assert_called_once()
    federated.start.assert_not_called()
    assert dispatch(agent, 'gmail')['available_tools'][0]['name'] == 'read_mail'
    assert dispatch(agent, 'github')['available_tools'][0]['name'] == 'get_repo'
    assert dispatch(agent, 'gmail')['status'] == 'activated'
    federated.start.assert_called_once()
    federated.list_tools_sync.assert_called_once()
    agent.close()
    for client in (gateway, federated):
        client.stop.assert_called_once()


def test_composite_activation_loads_its_deferred_providers(make_agent):
    agent, gateway, federated = make_agent()
    assert {t['name'] for t in dispatch(agent, 'bundle')['available_tools']} == {'forecast', 'read_mail'}
    gateway.start.assert_called_once()
    federated.start.assert_called_once()


@pytest.mark.parametrize('options', [{'auth_token': None}, {'allow_user_federation': False}, {'disabled_skills': ['gmail', 'github']}])
def test_unavailable_federated_skills_cannot_connect(make_agent, options):
    agent, _, federated = make_agent(**options)
    assert dispatch(agent, 'gmail').get('available_tools', []) == []
    federated.start.assert_not_called()


def test_disabled_and_unregistered_tools_are_not_bound(make_agent):
    agent, _, federated = make_agent(disabled_skills=['github'])
    assert dispatch(agent, 'gmail')['status'] == 'activated'
    assert 'github' not in agent._skill_registry.skill_names
    assert dispatch(agent, 'github')['status'] == 'error'
    assert {t.tool_name for t in agent._skill_registry.get_tools('gmail')} == {'read_mail'}
    federated.start.assert_called_once()


def test_discovery_follows_pages_without_publishing_partial_results(make_agent):
    agent, _, client = make_agent()
    client.list_tools_sync.side_effect = [PaginatedList([client.tools[0]], token='page-2'), RuntimeError('unavailable'),
        PaginatedList([client.tools[0]], token='page-2'), PaginatedList([client.tools[1]])]
    assert dispatch(agent, 'gmail')['status'] == 'error'
    assert agent._skill_registry._skills['gmail']['tools'] == []
    client.stop.assert_called_once()
    assert dispatch(agent, 'gmail')['status'] == 'activated'
    assert dispatch(agent, 'github')['status'] == 'activated'
    assert client.start.call_count == 2
    assert client.list_tools_sync.call_args_list[1].kwargs == {'pagination_token': 'page-2'}


def test_repeated_pagination_token_fails_without_hanging(make_agent):
    agent, _, client = make_agent()
    client.list_tools_sync.return_value = PaginatedList(client.tools, token='repeat')
    assert dispatch(agent, 'gmail')['status'] == 'error'
    assert client.list_tools_sync.call_count == 2
    client.stop.assert_called_once()


def test_concurrent_activations_start_one_connection(make_agent):
    agent, _, client = make_agent()
    barrier = threading.Barrier(4)
    def activate(name):
        barrier.wait(timeout=2)
        return dispatch(agent, name)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(activate, ['gmail', 'github', 'gmail', 'github']))
    assert all(r['status'] == 'activated' for r in results)
    client.start.assert_called_once()
    client.list_tools_sync.assert_called_once()


def test_context_keeps_schemas_and_execution_on_the_correct_agent(make_agent, monkeypatch):
    alice, _, alice_client = make_agent('alice')
    bob, _, bob_client = make_agent('bob')
    monkeypatch.setattr(skill_tools, '_registry', bob._skill_registry)
    assert dispatch(alice, 'gmail')['available_tools'][0]['description'] == 'alice'
    bob_client.start.assert_not_called()
    assert skill_tools._execute_tool(context(alice), 'gmail', 'read_mail', {}) == 'alice'
    alice_client.call_tool_sync.assert_called_once()
    bob_client.call_tool_sync.assert_not_called()
    assert dispatch(bob, 'gmail')['available_tools'][0]['description'] == 'bob'


def test_stop_during_discovery_prevents_the_external_action(make_agent):
    agent, _, client = make_agent()
    def stop_while_loading(**kwargs):
        signal_local_stop(agent.user_id, agent.session_id, 'run-1')
        return PaginatedList(client.tools)
    client.list_tools_sync.side_effect = stop_while_loading
    try:
        result = json.loads(skill_tools._execute_tool(context(agent), 'gmail', 'read_mail', {}))
        assert result['status'] == 'cancelled'
        client.call_tool_sync.assert_not_called()
    finally:
        clear_local_stop_event(agent.user_id, agent.session_id, 'run-1')
    client.list_tools_sync.side_effect = None
    assert skill_tools._execute_tool(context(agent, 'run-2'), 'gmail', 'read_mail', {}) == 'alice'


def test_already_stopped_run_does_not_even_connect(make_agent):
    agent, _, client = make_agent()
    signal_local_stop(agent.user_id, agent.session_id, 'run-1')
    try:
        assert dispatch(agent, 'gmail')['status'] == 'cancelled'
        client.start.assert_not_called()
    finally:
        clear_local_stop_event(agent.user_id, agent.session_id, 'run-1')


def test_closed_agent_cannot_open_a_deferred_connection(make_agent):
    agent, _, client = make_agent()
    agent.close()
    assert dispatch(agent, 'gmail')['status'] == 'error'
    client.start.assert_not_called()


def test_dispatcher_context_is_not_exposed_to_the_model():
    schema = skill_tools.skill_dispatcher.tool_spec['inputSchema']['json']
    assert set(schema['properties']) == {'skill_name', 'reference', 'source'}
