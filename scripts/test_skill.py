#!/usr/bin/env python3
"""
Skill Agent Integration Test Script

Tests the SkillChatAgent directly using the same flow as the /invocations router:
  1. create_agent("skill", ...) → SkillChatAgent
  2. AGUIStreamEventProcessor.process_stream(agent.agent, message, ...)
  3. Parse AG-UI SSE events

Usage:
    cd chatbot-app/agentcore
    python ../../scripts/test_skill.py                     # Run default scenario
    python ../../scripts/test_skill.py --scenario search   # Run specific scenario
    python ../../scripts/test_skill.py --query "Hello!"    # Custom query
    python ../../scripts/test_skill.py --list              # List scenarios
    python ../../scripts/test_skill.py --all               # Run all scenarios
"""

import argparse
import asyncio
import json
import sys
import os
import time
from typing import Any, Dict, List

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))


# =============================================================================
# Test Scenarios
# =============================================================================

SCENARIOS = {
    "greeting": {
        "name": "Simple Greeting",
        "query": "Hello! How are you doing today?",
        "description": "Basic chat - no tools needed, tests agent initialization and response",
    },
    "calculator": {
        "name": "Calculator Tool",
        "query": "What is 1234 * 5678?",
        "description": "Tests calculator skill tool invocation",
    },
    "search": {
        "name": "Web Search",
        "query": "Search the web for the latest Python 3.13 release features and summarize briefly",
        "description": "Tests web search skill with ddg_web_search tool",
    },
    "weather": {
        "name": "Weather Query",
        "query": "What's the current weather in Tokyo?",
        "description": "Tests gateway weather tool (requires gateway connection)",
    },
    "diagram": {
        "name": "Diagram Generation",
        "query": "Create a simple flowchart showing: Start -> Process Data -> Validate -> End",
        "description": "Tests visual-design skill (generate_chart tool)",
    },
    "multi_tool": {
        "name": "Multi-Tool Chain",
        "query": "Search the web for the population of Japan, then calculate what 2.5% of that number would be.",
        "description": "Tests chaining multiple skills: web search then calculator",
    },
    "word_doc": {
        "name": "Word Document",
        "query": "Create a Word document with a brief project status report. Include sections for Summary, Progress, and Next Steps.",
        "description": "Tests document creation skill (create_word_document tool)",
    },
}


# =============================================================================
# Pretty Printing
# =============================================================================

COLORS = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "cyan": "\033[36m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "magenta": "\033[35m",
    "red": "\033[31m",
}


def c(text: str, color: str) -> str:
    return f"{COLORS.get(color, '')}{text}{COLORS['reset']}"


def print_header(text: str):
    print(f"\n{c('=' * 70, 'dim')}")
    print(f"  {c(text, 'bold')}")
    print(f"{c('=' * 70, 'dim')}\n")


# =============================================================================
# Direct Skill Agent Test (same flow as router)
# =============================================================================

async def test_skill_direct(
    query: str,
    session_id: str,
    user_id: str,
    verbose: bool = False,
) -> Dict[str, Any]:
    """
    Test SkillChatAgent using the same flow as /invocations router:
      create_agent("skill") → AGUIStreamEventProcessor.process_stream(agent.agent, ...)
    """
    from agents.factory import create_agent
    from streaming.agui_event_processor import AGUIStreamEventProcessor

    print(f"{c('Query:', 'bold')} {query}")
    print(f"{c('Mode:', 'dim')} skill (SkillChatAgent)")
    print(f"{c('Session:', 'dim')} {session_id}")
    print()

    # 1. Create agent (same as router line 343-355)
    print(f"{c('Creating SkillChatAgent...', 'dim')}")
    agent = create_agent(
        request_type="skill",
        session_id=session_id,
        user_id=user_id,
    )
    print(f"Agent created (model: {c(agent.model_id, 'bold')}, tools: {len(agent.tools)})")

    # 2. Create AG-UI processor (same as router line 357)
    run_id = f"run-{session_id}"
    agui_processor = AGUIStreamEventProcessor(thread_id=session_id, run_id=run_id)

    # 3. Set env vars (same as router line 359-360)
    os.environ["SESSION_ID"] = session_id
    os.environ["USER_ID"] = user_id

    # 4. Build invocation_state (same as router line 362-368)
    invocation_state = {
        "session_id": session_id,
        "user_id": user_id,
        "model_id": agent.model_id,
        "session_manager": agent.session_manager,
    }

    print_header("AG-UI Event Stream")

    tools_used: List[str] = []
    response_text = ""
    event_counts: Dict[str, int] = {}
    start_time = time.time()

    # 5. Stream events (same as router line 409-418)
    try:
        async for sse_chunk in agui_processor.process_stream(
            agent.agent,
            query,
            session_id=session_id,
            invocation_state=invocation_state,
        ):
            # Parse SSE lines from chunk
            for line in sse_chunk.strip().split("\n"):
                if line.startswith("event:"):
                    # AG-UI format: "event:TYPE\ndata:{json}"
                    # We'll parse data on the next line
                    continue
                if not line.startswith("data:"):
                    continue

                try:
                    data = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue

                event_type = data.get("type", "unknown")
                event_counts[event_type] = event_counts.get(event_type, 0) + 1

                # --- RUN_STARTED ---
                if event_type == "RUN_STARTED":
                    print(f"  {c('[Run Started]', 'green')}")

                # --- TEXT_MESSAGE_CONTENT ---
                elif event_type == "TEXT_MESSAGE_CONTENT":
                    delta = data.get("delta", "")
                    response_text += delta
                    print(delta, end="", flush=True)

                # --- TOOL_CALL_START ---
                elif event_type == "TOOL_CALL_START":
                    tool_name = data.get("toolCallName", "unknown")
                    tools_used.append(tool_name)
                    print(f"\n  {c(f'Tool #{len(tools_used)}:', 'magenta')} {c(tool_name, 'bold')}")

                # --- TOOL_CALL_ARGS ---
                elif event_type == "TOOL_CALL_ARGS":
                    if verbose:
                        delta = data.get("delta", "")
                        if delta:
                            args_str = delta[:150] + "..." if len(delta) > 150 else delta
                            print(f"    {c('Args:', 'dim')} {args_str}")

                # --- TOOL_CALL_RESULT ---
                elif event_type == "TOOL_CALL_RESULT":
                    content = data.get("content", "")
                    try:
                        payload = json.loads(content)
                        result = payload.get("result", "")
                        has_images = bool(payload.get("images"))
                        has_metadata = bool(payload.get("metadata"))

                        extras = []
                        if has_images:
                            extras.append("images")
                        if has_metadata:
                            extras.append("metadata")

                        preview = result[:100] + "..." if len(result) > 100 else result
                        extra_str = f" [{', '.join(extras)}]" if extras else ""
                        print(f"    {c('Result:', 'dim')} {preview}{c(extra_str, 'cyan')}")
                    except (json.JSONDecodeError, TypeError):
                        print(f"    {c('Result:', 'dim')} (raw)")

                # --- RUN_FINISHED ---
                elif event_type == "RUN_FINISHED":
                    elapsed = time.time() - start_time
                    print(f"\n\n  {c('[Run Finished]', 'green')} {elapsed:.1f}s")

                # --- RUN_ERROR ---
                elif event_type == "RUN_ERROR":
                    msg = data.get("message", "unknown error")
                    print(f"\n  {c('[ERROR]', 'red')} {msg}")

                # --- CUSTOM ---
                elif event_type == "CUSTOM":
                    name = data.get("name", "?")
                    if name == "reasoning" and verbose:
                        text = data.get("value", {}).get("text", "")
                        print(f"  {c('[thinking]', 'dim')} {text[:80]}")
                    elif name == "complete_metadata":
                        usage = data.get("value", {}).get("usage")
                        if usage:
                            inp = usage.get("inputTokens", 0)
                            out = usage.get("outputTokens", 0)
                            print(f"  {c('Tokens:', 'dim')} {inp:,} in / {out:,} out")

    except Exception as e:
        import traceback
        print(f"\n{c('Stream Error:', 'red')} {e}")
        if verbose:
            traceback.print_exc()

    # Summary
    elapsed = time.time() - start_time
    print_header("Summary")

    print(f"{c('Duration:', 'bold')} {elapsed:.1f}s")
    print(f"{c('Response Length:', 'bold')} {len(response_text)} chars")

    if tools_used:
        print(f"\n{c('Tools Used:', 'bold')} {len(tools_used)}")
        for i, name in enumerate(tools_used, 1):
            print(f"  {i}. {name}")
    else:
        print(f"\n{c('Tools Used:', 'bold')} (none)")

    print(f"\n{c('Event Counts:', 'bold')}")
    for evt, cnt in sorted(event_counts.items()):
        print(f"  {evt}: {cnt}")

    if response_text.strip():
        print_header("Final Response (first 500 chars)")
        print(response_text.strip()[:500])
        if len(response_text) > 500:
            print(f"\n{c('... (truncated)', 'dim')}")

    return {
        "scenario": session_id,
        "tools_used": tools_used,
        "response_length": len(response_text),
        "event_counts": event_counts,
        "duration": elapsed,
        "success": bool(response_text.strip()),
    }


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Test Skill Agent (SkillChatAgent) directly",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_skill.py                        # Run default (greeting) scenario
  python test_skill.py --scenario search      # Run web search scenario
  python test_skill.py --scenario multi_tool  # Multi-tool chain test
  python test_skill.py --query "Hello!"       # Custom query
  python test_skill.py --all                  # Run all scenarios sequentially
  python test_skill.py --list                 # List available scenarios
  python test_skill.py -v                     # Verbose output
        """,
    )
    parser.add_argument("--query", help="Custom query to test")
    parser.add_argument("--scenario", choices=list(SCENARIOS.keys()), default="greeting")
    parser.add_argument("--session-id", default=None, help="Session ID (auto-generated if not set)")
    parser.add_argument("--user-id", default="test-user")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("--all", action="store_true", help="Run all scenarios")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if args.list:
        print_header("Available Test Scenarios")
        for key, s in SCENARIOS.items():
            print(f"  {c(key, 'bold')}: {s['name']}")
            print(f"    {c('Query:', 'dim')} {s['query']}")
            print(f"    {s['description']}")
            print()
        return 0

    if args.all:
        # Run all scenarios sequentially
        print_header("Running All Scenarios")
        results = []

        for key, scenario in SCENARIOS.items():
            sid = f"test-skill-{key}"
            print_header(f"Scenario: {scenario['name']}")
            try:
                result = asyncio.run(test_skill_direct(
                    query=scenario["query"],
                    session_id=sid,
                    user_id=args.user_id,
                    verbose=args.verbose,
                ))
                results.append(result)
            except KeyboardInterrupt:
                print(f"\n{c('Interrupted', 'yellow')}")
                break
            except Exception as e:
                print(f"\n{c('Error:', 'red')} {e}")
                results.append({"scenario": key, "success": False, "error": str(e)})

        # Final summary
        print_header("All Scenarios Summary")
        for r in results:
            status = c("PASS", "green") if r.get("success") else c("FAIL", "red")
            tools = ", ".join(r.get("tools_used", [])) or "(none)"
            duration = f"{r.get('duration', 0):.1f}s"
            print(f"  {status} {r['scenario']:20s} {duration:>8s}  tools: {tools}")

        passed = sum(1 for r in results if r.get("success"))
        print(f"\n  {passed}/{len(results)} passed")
        return 0 if passed == len(results) else 1

    # Single scenario
    if args.query:
        query = args.query
        scenario_name = "Custom Query"
        session_id = args.session_id or "test-skill-custom"
    else:
        scenario = SCENARIOS[args.scenario]
        query = scenario["query"]
        scenario_name = scenario["name"]
        session_id = args.session_id or f"test-skill-{args.scenario}"

    print_header(f"Skill Agent Test: {scenario_name}")

    try:
        asyncio.run(test_skill_direct(
            query=query,
            session_id=session_id,
            user_id=args.user_id,
            verbose=args.verbose,
        ))
        return 0

    except KeyboardInterrupt:
        print(f"\n{c('Interrupted', 'yellow')}")
        return 130
    except Exception as e:
        print(f"\n{c('Error:', 'red')} {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
