"""Both response lengths preserve one voice, language policy, and tool rules.

Structural checks protect assembly/wiring. Naturalness is evaluated separately
against live model outputs; keyword assertions cannot measure writing quality.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from agent.config.prompt_builder import (
    BASE_TEXT_PROMPT,
    CONCISE_RESPONSE_GUIDANCE,
    build_text_system_prompt,
    build_voice_system_prompt,
    system_prompt_to_string,
)

RETIRED_RULES = (
    "at least 1-2 sentences", "without bullet points or numbered lists",
    "Cap lists at 5", "No recap of what you just did", "Never open with",
)

def normal():
    return system_prompt_to_string(build_text_system_prompt())

def concise():
    return system_prompt_to_string(build_text_system_prompt(concise=True))

class TestSharedVoice:
    def test_concise_adds_only_length_guidance(self):
        regular = build_text_system_prompt()[0]['text']
        short = build_text_system_prompt(concise=True)[0]['text']
        assert regular == BASE_TEXT_PROMPT
        assert short == regular + "\n\n" + CONCISE_RESPONSE_GUIDANCE

    def test_rules_and_examples_are_not_duplicated(self):
        for prompt in (normal(), concise()):
            for section in ('communication_style', 'response_approach', 'response_examples', 'tool_usage'):
                assert prompt.count(f'<{section}>') == 1
            for rule in RETIRED_RULES:
                assert rule not in prompt
        assert '<response_length>' not in normal()
        assert concise().count('<response_length>') == 1

    def test_tool_permissions_and_evidence_survive_both_modes(self):
        for prompt in (normal(), concise()):
            assert 'ONLY use tools that are explicitly provided' in prompt
            assert 'Never invent a saved file' in prompt
            assert 'Preserve permissions and confirmation requirements' in prompt
            assert 'uncertainty, assumptions, negations, numbers, units' in prompt

    def test_explicit_output_preferences_apply_in_both_modes(self):
        for prompt in (normal(), concise()):
            assert "requested output language, currency, audience, and format across turns" in prompt
            assert "Otherwise, reply in the user's language" in prompt

    def test_date_and_voice_mode_are_preserved(self):
        assert build_text_system_prompt()[1]['text'].startswith('Current date:')
        assert build_text_system_prompt(concise=True)[1]['text'].startswith('Current date:')
        voice = build_voice_system_prompt()
        assert '<voice_style>' in voice
        assert '<response_length>' not in voice


class TestAgentWiring:
    """The flag has to reach the prompt builder from the agent.

    Calls _build_system_prompt directly on a bare instance rather than inspecting
    source: a wiring check that only greps for the word "concise" still passes
    when the agent calls the builder without forwarding the flag.
    """

    @staticmethod
    def _prompt_for(agent_cls, concise: bool) -> str:
        instance = agent_cls.__new__(agent_cls)
        instance._closed = True  # No runtime resources were opened by this fixture.
        instance.concise_mode = concise
        return system_prompt_to_string(instance._build_system_prompt())

    def test_skill_chat_agent_honours_the_flag(self):
        # SkillChatAgent is the agent the chat path uses; it previously inlined
        # BASE_TEXT_PROMPT, which bypassed the toggle entirely.
        from agents.skill_chat_agent import SkillChatAgent

        assert "<response_length>" in self._prompt_for(SkillChatAgent, True)
        assert "<response_length>" not in self._prompt_for(SkillChatAgent, False)

    def test_skill_chat_agent_drops_conflicting_guidance(self):
        from agents.skill_chat_agent import SkillChatAgent

        prompt = self._prompt_for(SkillChatAgent, True)
        for phrase in RETIRED_RULES:
            assert phrase not in prompt

    def test_chat_agent_honours_the_flag(self):
        from agents.chat_agent import ChatAgent

        assert "<response_length>" in self._prompt_for(ChatAgent, True)
        assert "<response_length>" not in self._prompt_for(ChatAgent, False)

    # The wiring tests above build instances with __new__, which skips __init__ and
    # therefore missed a real break: ChatAgent lists its parameters explicitly
    # rather than taking **kwargs, so passing concise_mode through the factory
    # raised TypeError at runtime while every test still passed.
    def test_agent_constructors_accept_the_flag(self):
        import inspect

        from agents.chat_agent import ChatAgent
        from agents.skill_chat_agent import SkillChatAgent
        from agents.base import BaseAgent

        for cls in (BaseAgent, ChatAgent, SkillChatAgent):
            params = inspect.signature(cls.__init__).parameters
            accepts = "concise_mode" in params or any(
                p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()
            )
            assert accepts, f"{cls.__name__}.__init__ rejects concise_mode"

    def test_factory_forwards_the_flag_to_the_agent(self):
        import inspect

        from agents import factory

        params = inspect.signature(factory.create_agent).parameters
        assert "concise_mode" in params
        assert "concise_mode=concise_mode" in inspect.getsource(factory.create_agent)

    def test_agents_default_to_the_normal_style(self):
        # concise_mode absent entirely (not just False) must not enable it.
        from agents.skill_chat_agent import SkillChatAgent

        instance = SkillChatAgent.__new__(SkillChatAgent)
        instance._closed = True
        prompt = system_prompt_to_string(instance._build_system_prompt())
        assert "<response_length>" not in prompt
