import pytest

from agent.config.model_catalog import (
    get_model_catalog,
    normalize_model_id,
    normalize_task_complexity,
    resolve_code_agent_model,
    resolve_general_subagent_model,
)


class TestGeneralSubagentSelection:
    @pytest.mark.parametrize(
        ("parent_model_id", "complexity", "expected_model_id"),
        [
            (
                "us.anthropic.claude-sonnet-5",
                "low",
                "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            ),
            (
                "us.anthropic.claude-sonnet-5",
                "medium",
                "us.anthropic.claude-sonnet-5",
            ),
            (
                "us.anthropic.claude-sonnet-5",
                "high",
                "anthropic.claude-opus-5-5",
            ),
            (
                "openai.gpt-6-sol",
                "low",
                "openai.gpt-6-luna",
            ),
            (
                "openai.gpt-6-sol",
                "medium",
                "openai.gpt-6-sol",
            ),
            (
                "openai.gpt-6-sol",
                "high",
                "openai.gpt-6-sol",
            ),
        ],
    )
    def test_maps_supported_providers_by_complexity(
        self,
        parent_model_id,
        complexity,
        expected_model_id,
    ):
        selection = resolve_general_subagent_model(
            parent_model_id,
            complexity,
        )
        assert selection.effective_model_id == expected_model_id
        assert selection.applied is True

    def test_unknown_provider_keeps_parent_model(self):
        selection = resolve_general_subagent_model("xai.grok-4.3", "high")
        assert selection.effective_model_id == "us.xai.grok-4.6"
        assert selection.applied is False

    def test_other_openai_family_keeps_parent_model(self):
        selection = resolve_general_subagent_model(
            "openai.gpt-oss-120b-1:0",
            "high",
        )
        assert selection.effective_model_id == "openai.gpt-oss-120b-1:0"
        assert selection.applied is False

    def test_omitted_complexity_keeps_parent_model(self):
        selection = resolve_general_subagent_model(
            "us.anthropic.claude-sonnet-5",
            None,
        )
        assert selection.effective_model_id == "us.anthropic.claude-sonnet-5"
        assert selection.applied is False

    def test_provider_matcher_supports_other_bedrock_claude_ids(self):
        selection = resolve_general_subagent_model(
            "eu.anthropic.claude-custom-v1:0",
            "high",
        )
        assert selection.effective_model_id == "anthropic.claude-opus-5-5"


class TestCodeAgentSelection:
    @pytest.mark.parametrize(
        ("complexity", "expected_model_id"),
        [
            ("low", "us.anthropic.claude-haiku-4-5-20251001-v1:0"),
            ("medium", "us.anthropic.claude-sonnet-5"),
            ("high", "anthropic.claude-opus-5-5"),
        ],
    )
    def test_always_selects_claude_tier(self, complexity, expected_model_id):
        selection = resolve_code_agent_model(complexity)
        assert selection.provider == "anthropic"
        assert selection.family == "claude"
        assert selection.effective_model_id == expected_model_id

    def test_defaults_to_medium(self):
        assert (
            resolve_code_agent_model(None).effective_model_id
            == "us.anthropic.claude-sonnet-5"
        )


def test_catalog_has_unique_model_ids():
    catalog = get_model_catalog()
    assert len(catalog.models) == len(catalog.models_by_id)


def test_models_use_verified_endpoint_and_region():
    catalog = get_model_catalog()
    assert catalog.models["gpt.astra.latest"].transport == "bedrock_responses"
    for key in ("gpt.sol.latest", "gpt.luna.latest"):
        assert catalog.models[key].transport == "mantle_responses"
        assert catalog.models[key].region == "us-east-1"
    assert catalog.models["claude.opus.latest"].transport == "mantle_anthropic"
    assert catalog.models["claude.opus.latest"].region == "us-east-1"


@pytest.mark.parametrize(("legacy_id", "canonical_id"), [
    ("us.anthropic.claude-opus-5", "anthropic.claude-opus-5-5"),
    ("openai.gpt-5.6-sol", "openai.gpt-6-sol"),
    ("us.openai.gpt-5.6-sol", "openai.gpt-6-sol"),
    ("openai.gpt-5.6-terra", "openai.gpt-6-sol"),
    ("us.openai.gpt-5.6-terra", "openai.gpt-6-sol"),
    ("openai.gpt-5.6-luna", "openai.gpt-6-luna"),
    ("us.openai.gpt-5.6-luna", "openai.gpt-6-luna"),
    ("us.openai.gpt-6-sol", "openai.gpt-6-sol"),
    ("us.openai.gpt-6-luna", "openai.gpt-6-luna"),
    ("us.anthropic.claude-opus-5-5", "anthropic.claude-opus-5-5"),
    ("openai.gpt-6-astra", "us.openai.gpt-6-astra"),
    ("openai.gpt-6-sol", "openai.gpt-6-sol"),
    ("xai.grok-4.3", "us.xai.grok-4.6"),
])
def test_legacy_model_ids_are_normalized(legacy_id, canonical_id):
    assert normalize_model_id(legacy_id) == canonical_id


def test_invalid_complexity_is_rejected():
    with pytest.raises(ValueError, match="low, medium, or high"):
        normalize_task_complexity("extreme")
