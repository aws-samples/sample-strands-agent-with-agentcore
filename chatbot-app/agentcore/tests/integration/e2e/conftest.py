"""Shared fixtures for e2e tests against the deployed stack.

Required env vars (populate from `terraform output` — see README.md):
  E2E_BFF_URL, E2E_COGNITO_REGION, E2E_COGNITO_CLIENT_ID,
  E2E_TEST_USERNAME, E2E_TEST_PASSWORD
Optional: RUN_3LO=1 to enable 3LO (Gmail / GitHub) test cases.
"""

from __future__ import annotations

import os
from typing import Callable

import pytest

from .cognito_auth import get_access_token
from .sse_client import StreamResult, stream_chat


def _require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        pytest.skip(f"e2e test requires env var {name}; see tests/integration/e2e/README.md")
    return val


@pytest.fixture(scope="session")
def bff_url() -> str:
    return _require_env("E2E_BFF_URL")


@pytest.fixture(scope="session")
def cognito_token() -> str:
    return get_access_token(
        region=_require_env("E2E_COGNITO_REGION"),
        client_id=_require_env("E2E_COGNITO_CLIENT_ID"),
        username=_require_env("E2E_TEST_USERNAME"),
        password=_require_env("E2E_TEST_PASSWORD"),
    )


StreamChatFn = Callable[..., StreamResult]


@pytest.fixture
def stream(bff_url: str, cognito_token: str) -> StreamChatFn:
    """Curried helper: call `stream(prompt, **kwargs)` to exercise one agent turn."""

    def _call(prompt: str, **kwargs) -> StreamResult:
        return stream_chat(bff_url, cognito_token, prompt, **kwargs)

    return _call
