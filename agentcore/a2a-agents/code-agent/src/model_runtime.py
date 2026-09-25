"""Pure helpers for request-scoped Code Agent model selection."""

from __future__ import annotations

from typing import Any


def effective_model_id(metadata: dict[str, Any], default_model_id: str) -> str:
    model_id = str(metadata.get("model_id") or default_model_id)
    if model_id == "us.anthropic.claude-opus-5-5":
        return "anthropic.claude-opus-5-5"
    return model_id


def uses_mantle(model_id: str | None) -> bool:
    return model_id == "anthropic.claude-opus-5-5"


def needs_model_switch(
    cached_model_id: str,
    requested_model_id: str,
) -> bool:
    return cached_model_id != requested_model_id
