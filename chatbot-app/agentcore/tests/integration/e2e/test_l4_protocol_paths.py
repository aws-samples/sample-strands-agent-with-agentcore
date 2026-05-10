"""L4 agent-turn integration tests, one case per protocol path.

Each case sends a prompt through the deployed BFF and asserts — from the SSE
event stream — that the correct tool was invoked for its protocol. Text
matching is avoided except where a tool choice cannot be observed directly
(memory roundtrip).

Run: `pytest -m e2e tests/integration/e2e -v`
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.e2e


def _assert_skill_or_tool_invoked(result, substrings: tuple[str, ...]) -> None:
    """Assert the agent exercised the expected protocol path.

    All tools in this project flow through `skill_executor` / `skill_dispatcher`
    (see src/skill/). The effective tool identity lives in the
    TOOL_CALL_ARGS payload (`skill_name`, `tool_name`) for those, so we match
    against the flattened list that includes both the top-level tool name and
    the inner skill/tool names.

    For each matched substring we also require at least one invocation that
    did NOT error out — so a broken skill path fails the test instead of
    silently passing on "the agent at least tried".
    """
    invocations = result.invocations()
    subs = tuple(s.lower() for s in substrings)
    haystacks = [
        (inv, " ".join(filter(None, (
            inv.tool_call_name, inv.skill_name, inv.inner_tool_name
        ))).lower())
        for inv in invocations
    ]
    matching = [inv for inv, hay in haystacks if any(s in hay for s in subs)]
    assert matching, (
        f"Expected a tool/skill matching one of {substrings}. "
        f"Observed invocations: "
        f"{[(inv.tool_call_name, inv.skill_name, inv.inner_tool_name) for inv in invocations]}. "
        f"Errors: {result.raw_error_events}"
    )
    ok = [inv for inv in matching if not inv.is_error and inv.result_preview is not None]
    # Accept approval-interrupted runs: the tool dispatched correctly but was
    # paused before execution. No result_preview will exist.
    if not ok and result.interrupted_for_approval():
        return
    assert ok, (
        f"All matching invocations for {substrings} failed or never returned. "
        f"Previews: {[(inv.effective_name, inv.is_error, (inv.result_preview or '')[:200]) for inv in matching]}"
    )


_RUN_3LO = os.environ.get("RUN_3LO") == "1"


_CASES = [
    pytest.param(
        "Make a simple bar chart of these values: [1, 2, 3, 4, 5] with labels a,b,c,d,e.",
        ("visualization", "create_visualization"),
        {"timeout": 180.0},
        id="local_python_viz",
    ),
    pytest.param(
        "Draw an excalidraw diagram with two boxes labeled A and B connected by an arrow.",
        ("excalidraw", "create_excalidraw_diagram"),
        {"timeout": 180.0},
        id="local_excalidraw",
    ),
    pytest.param(
        "Use the code interpreter to compute 7 * 191 and tell me the result.",
        ("code-interpreter", "execute_code"),
        {"timeout": 240.0},
        id="builtin_code_interp",
    ),
    pytest.param(
        "Open https://example.com in a browser and tell me the page title.",
        ("browser-automation", "browser_act", "browser_get_page_info"),
        {"timeout": 360.0},
        id="builtin_browser",
    ),
    pytest.param(
        "Find recent arxiv papers on Mamba state space models.",
        ("arxiv-search", "arxiv_search"),
        {"timeout": 180.0},
        id="gateway_arxiv",
    ),
    pytest.param(
        "What is the current stock price of AAPL?",
        ("financial-news", "stock_quote", "stock_analysis"),
        {"timeout": 180.0},
        id="gateway_finance",
    ),
    pytest.param(
        "What's the weather in Seoul today?",
        ("weather",),
        {"timeout": 180.0},
        id="gateway_weather",
    ),
    pytest.param(
        "Search the web for the latest news on LLM evaluation benchmarks.",
        ("web-search", "tavily-search", "google-web-search", "web_search", "tavily_search"),
        {"timeout": 180.0},
        id="gateway_web_search",
    ),
    pytest.param(
        "Give me a brief Wikipedia summary of Alan Turing.",
        ("wikipedia",),
        {"timeout": 180.0},
        id="gateway_wikipedia",
    ),
    pytest.param(
        "Do deep research comparing vector databases in 2026 — pinecone, weaviate, "
        "and qdrant — focusing on performance and pricing. Use the research agent.",
        ("research-agent", "research_agent"),
        {"timeout": 600.0},
        id="a2a_research",
    ),
    pytest.param(
        "Delegate to the coding agent: write a FastAPI hello-world endpoint and "
        "save it to the workspace as app.py.",
        ("code-agent", "code_agent"),
        {"timeout": 600.0},
        id="a2a_code",
    ),
    pytest.param(
        "Create a 3-slide PowerPoint presentation titled 'AWS Lambda Basics' "
        "with slides about runtime, pricing, and use cases.",
        ("powerpoint-presentations", "create_presentation"),
        {"timeout": 300.0, "state_overrides": {"request_type": "skill"}},
        id="skill_ppt",
    ),
]

_3LO_CASES = [
    pytest.param(
        "List my 3 most recent Gmail messages.",
        ("gmail_list", "list_messages"),
        {"timeout": 240.0},
        id="gateway_3lo_gmail",
        marks=pytest.mark.skipif(not _RUN_3LO, reason="set RUN_3LO=1 to enable"),
    ),
    pytest.param(
        "List my top 5 GitHub repositories.",
        ("github", "list_repos"),
        {"timeout": 240.0},
        id="gateway_3lo_github",
        marks=pytest.mark.skipif(not _RUN_3LO, reason="set RUN_3LO=1 to enable"),
    ),
]


@pytest.mark.parametrize("prompt,expected_tool_substrings,call_kwargs", _CASES + _3LO_CASES)
def test_protocol_path(stream, prompt, expected_tool_substrings, call_kwargs):
    result = stream(prompt, **call_kwargs)
    assert result.terminated_cleanly(), (
        f"Neither RUN_FINISHED nor an approval interrupt observed. "
        f"Errors: {result.raw_error_events}. "
        f"Last events: {[e.get('type') for e in result.events[-10:]]}"
    )
    _assert_skill_or_tool_invoked(result, expected_tool_substrings)


def test_memory_roundtrip(stream):
    """Two turns sharing a thread_id — the second turn must recall the first."""
    from .sse_client import _make_thread_id

    tid = _make_thread_id()
    turn1 = stream(
        "Please remember this fact about me for later: my primary programming "
        "language is Go (Golang). Just acknowledge.",
        thread_id=tid,
        timeout=180.0,
    )
    assert turn1.run_finished(), f"Turn 1 failed: {turn1.raw_error_events}"

    turn2 = stream(
        "Based on what I told you earlier, what is my primary programming language?",
        thread_id=tid,
        timeout=180.0,
    )
    assert turn2.run_finished(), f"Turn 2 failed: {turn2.raw_error_events}"

    text = turn2.assistant_text().lower()
    assert "go" in text or "golang" in text, (
        f"Turn 2 response should mention Go/Golang. Got: {text[:400]!r}"
    )
