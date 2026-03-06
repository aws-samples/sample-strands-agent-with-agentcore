#!/usr/bin/env python3
"""
Swarm Multi-Agent Test Script

Tests the Swarm implementation directly and shows the expected SSE event format.

Usage:
    cd chatbot-app/agentcore
    python ../../scripts/test_swarm.py
    python ../../scripts/test_swarm.py --scenario weather
    python ../../scripts/test_swarm.py --query "What is Python?"
    python ../../scripts/test_swarm.py --http  # Test via HTTP API

Event Format Reference:
    - swarm_node_start: {"type": "swarm_node_start", "node_id": "...", "node_description": "..."}
    - swarm_node_stop:  {"type": "swarm_node_stop", "node_id": "...", "status": "completed|failed"}
    - swarm_handoff:    {"type": "swarm_handoff", "from_node": "...", "to_node": "...", "context": {...}}
    - swarm_complete:   {"type": "swarm_complete", "total_nodes": N, "node_history": [...], "status": "..."}
    - response:         {"type": "response", "text": "...", "node_id": "responder"}
    - text:             {"type": "text", "content": "...", "node_id": "..."} (intermediate agents)
"""

import argparse
import asyncio
import json
import sys
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))


# =============================================================================
# Test Scenarios
# =============================================================================

SCENARIOS = {
    "simple": {
        "name": "Simple Query → Responder Only",
        "query": "Hello! How are you?",
        "expected_agents": ["coordinator", "responder"],
        "description": "Coordinator routes directly to responder for greetings",
    },
    "calculator": {
        "name": "Calculator → Data Analyst",
        "query": "Calculate 15 * 23 + 100",
        "expected_agents": ["coordinator", "data_analyst", "responder"],
        "description": "Coordinator routes to data_analyst for math, then responder",
    },
    "weather": {
        "name": "Weather Query → Weather Agent",
        "query": "What's the weather in Seoul today?",
        "expected_agents": ["coordinator", "weather_agent", "responder"],
        "description": "Coordinator routes to weather_agent, then responder",
    },
    "search": {
        "name": "Web Search → Web Researcher",
        "query": "Search for Python programming language and summarize",
        "expected_agents": ["coordinator", "web_researcher", "responder"],
        "description": "Coordinator routes to web_researcher, then responder",
    },
    "multi": {
        "name": "Multi-Agent → Search + Calculate",
        "query": "First, search the web for the current population of South Korea. Then calculate what 3.5% of that population would be.",
        "expected_agents": ["coordinator", "web_researcher", "data_analyst", "responder"],
        "description": "Coordinator routes to web_researcher, then data_analyst, then responder (2-3 handoffs)",
    },
}


# =============================================================================
# Event Format Classes (matches swarm_schemas.py)
# =============================================================================

@dataclass
class SwarmNodeStartEvent:
    """SSE format: {"type": "swarm_node_start", "node_id": "...", "node_description": "..."}"""
    node_id: str
    node_description: str
    type: str = "swarm_node_start"

    def to_sse(self) -> str:
        return f"data: {json.dumps({'type': self.type, 'node_id': self.node_id, 'node_description': self.node_description})}\n\n"


@dataclass
class SwarmNodeStopEvent:
    """SSE format: {"type": "swarm_node_stop", "node_id": "...", "status": "..."}"""
    node_id: str
    status: str  # "completed" | "failed" | "interrupted"
    type: str = "swarm_node_stop"

    def to_sse(self) -> str:
        return f"data: {json.dumps({'type': self.type, 'node_id': self.node_id, 'status': self.status})}\n\n"


@dataclass
class SwarmHandoffEvent:
    """SSE format: {"type": "swarm_handoff", "from_node": "...", "to_node": "...", ...}"""
    from_node: str
    to_node: str
    message: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    type: str = "swarm_handoff"

    def to_sse(self) -> str:
        data = {
            'type': self.type,
            'from_node': self.from_node,
            'to_node': self.to_node,
            'message': self.message,
            'context': self.context
        }
        return f"data: {json.dumps(data)}\n\n"


@dataclass
class SwarmCompleteEvent:
    """SSE format: {"type": "swarm_complete", "total_nodes": N, "node_history": [...], ...}"""
    total_nodes: int
    node_history: List[str]
    status: str
    final_response: Optional[str] = None
    final_node_id: Optional[str] = None
    shared_context: Optional[Dict[str, Any]] = None
    type: str = "swarm_complete"

    def to_sse(self) -> str:
        data = {
            'type': self.type,
            'total_nodes': self.total_nodes,
            'node_history': self.node_history,
            'status': self.status,
            'final_response': self.final_response,
            'final_node_id': self.final_node_id,
            'shared_context': self.shared_context
        }
        return f"data: {json.dumps(data)}\n\n"


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
    """Colorize text."""
    return f"{COLORS.get(color, '')}{text}{COLORS['reset']}"


def print_header(text: str):
    print(f"\n{c('=' * 70, 'dim')}")
    print(f"  {c(text, 'bold')}")
    print(f"{c('=' * 70, 'dim')}\n")


def print_sse_event(event_name: str, data: dict):
    """Print formatted SSE event."""
    print(f"{c('data:', 'dim')} {json.dumps(data)}")


def print_event_sdk(event_type: str, data: dict, current_node: str):
    """Print SDK event with translation to SSE format."""

    if event_type == "multiagent_node_start":
        node_id = data.get("node_id", "unknown")
        from agent.config.swarm_config import AGENT_DESCRIPTIONS
        desc = AGENT_DESCRIPTIONS.get(node_id, "")

        print(f"\n{c('[NODE START]', 'green')} {c(node_id, 'bold')}")
        print(f"  {c('→ SSE:', 'dim')} {json.dumps({'type': 'swarm_node_start', 'node_id': node_id, 'node_description': desc})}")

    elif event_type == "multiagent_node_stop":
        node_id = data.get("node_id", "unknown")
        node_result = data.get("node_result", {})

        status = "completed"
        if hasattr(node_result, "status"):
            status = str(node_result.status).split(".")[-1].lower()
        elif isinstance(node_result, dict):
            status = node_result.get("status", "completed")

        print(f"\n{c('[NODE STOP]', 'yellow')} {c(node_id, 'bold')} → {status}")
        print(f"  {c('→ SSE:', 'dim')} {json.dumps({'type': 'swarm_node_stop', 'node_id': node_id, 'status': status})}")

    elif event_type == "multiagent_handoff":
        from_nodes = data.get("from_node_ids", [])
        to_nodes = data.get("to_node_ids", [])
        message = data.get("message")

        from_node = from_nodes[0] if from_nodes else "?"
        to_node = to_nodes[0] if to_nodes else "?"

        print(f"\n{c('[HANDOFF]', 'cyan')} {from_node} {c('→', 'dim')} {c(to_node, 'bold')}")
        if message:
            print(f"  {c('Message:', 'dim')} {message[:100]}...")
        print(f"  {c('→ SSE:', 'dim')} {json.dumps({'type': 'swarm_handoff', 'from_node': from_node, 'to_node': to_node})}")

    elif event_type == "multiagent_node_stream":
        inner = data.get("event", {})

        # Text streaming
        if "data" in inner:
            text = inner["data"]
            if text.strip():
                if current_node == "responder":
                    # Responder text → sent to frontend as "response" event
                    print(text, end="", flush=True)
                else:
                    # Intermediate agent text → "text" event (for progress display)
                    pass  # Usually not printed in test

        # Tool use
        elif inner.get("type") == "tool_use":
            tool_name = inner.get("name", "unknown")
            print(f"\n  {c('[TOOL]', 'magenta')} {tool_name}")

        # Tool result
        elif inner.get("type") == "tool_result":
            result = str(inner.get("result", ""))[:80]
            print(f"  {c('[RESULT]', 'dim')} {result}...")

    elif event_type == "multiagent_result":
        result = data.get("result", {})
        status = "completed"
        if hasattr(result, "status"):
            status = str(result.status).split(".")[-1].lower()
        elif isinstance(result, dict):
            status = result.get("status", "completed")

        print(f"\n{c('[SWARM COMPLETE]', 'green')} Status: {status}")


# =============================================================================
# Direct Swarm Test
# =============================================================================

async def test_swarm_direct(query: str, session_id: str, user_id: str, verbose: bool = False):
    """Test Swarm directly using SwarmAgent.

    SwarmAgent.stream_async() yields SSE-formatted strings (same as HTTP API).
    We parse the SSE events and display them.
    """

    from agents.swarm_agent import SwarmAgent

    print(f"{c('Query:', 'bold')} {query}")
    print(f"{c('Session:', 'dim')} {session_id}")
    print()

    # Create SwarmAgent
    print(f"{c('Creating SwarmAgent...', 'dim')}")
    agent = SwarmAgent(
        session_id=session_id,
        user_id=user_id,
    )

    print(f"SwarmAgent created (model: {c(agent.model_id, 'bold')})")

    print_header("SSE Event Stream")

    tools_used = []         # tool names in order
    final_response_text = ""
    event_counts: Dict[str, int] = {}

    # Execute with streaming — yields SSE strings
    # Note: SwarmAgent.stream_async() emits standard SSE events (tool_use, response, complete)
    # NOT swarm-specific events (node_start/stop/handoff). Agent handoffs happen internally.
    async for sse_chunk in agent.stream_async(message=query):
        # Parse SSE data lines
        for line in sse_chunk.strip().split("\n"):
            if not line.startswith("data: "):
                continue

            try:
                data = json.loads(line[6:])
                event_type = data.get("type", "unknown")
                event_counts[event_type] = event_counts.get(event_type, 0) + 1

                if event_type == "tool_use":
                    tool_name = data.get("name", "unknown")
                    tool_id = data.get("toolUseId", "")
                    tools_used.append(tool_name)
                    print(f"\n  {c(f'Tool #{len(tools_used)}:', 'magenta')} {c(tool_name, 'bold')}")
                    tool_input = data.get("input", {})
                    if tool_input and verbose:
                        input_str = json.dumps(tool_input, ensure_ascii=False)
                        if len(input_str) > 120:
                            input_str = input_str[:120] + "..."
                        print(f"    {c('Input:', 'dim')} {input_str}")

                elif event_type == "tool_result":
                    status = data.get("status", "success")
                    result_text = data.get("result", "")
                    if result_text and verbose:
                        if len(result_text) > 120:
                            result_text = result_text[:120] + "..."
                        print(f"    {c(f'Result ({status}):', 'dim')} {result_text}")
                    else:
                        print(f"    {c(f'Result:', 'dim')} {status}")

                elif event_type == "response":
                    text = data.get("text", "")
                    final_response_text += text
                    print(text, end="", flush=True)

                elif event_type == "reasoning":
                    if verbose:
                        text = data.get("text", "")
                        print(f"{c('[thinking]', 'dim')} {text[:80]}", end="", flush=True)

                elif event_type == "start":
                    print(f"  {c('[Stream started]', 'dim')}")

                elif event_type == "complete":
                    usage = data.get("usage")
                    if usage:
                        inp = usage.get("inputTokens", 0)
                        out = usage.get("outputTokens", 0)
                        print(f"\n\n  {c('[Complete]', 'green')} Tokens: {inp:,} in / {out:,} out")
                    else:
                        print(f"\n\n  {c('[Complete]', 'green')}")

                elif event_type == "error":
                    content = data.get("content", "unknown error")
                    print(f"\n  {c('[ERROR]', 'red')} {content}")

            except json.JSONDecodeError:
                continue

    # Summary
    print_header("Summary")

    if tools_used:
        print(f"{c('Tools Used:', 'bold')} {len(tools_used)}")
        for i, name in enumerate(tools_used, 1):
            print(f"  {i}. {name}")
    else:
        print(f"{c('Tools Used:', 'bold')} (none)")

    print(f"\n{c('Event Counts:', 'bold')}")
    for evt, cnt in sorted(event_counts.items()):
        print(f"  {evt}: {cnt}")
    print()

    # Print final response
    if final_response_text.strip():
        print_header("Final Response")
        print(final_response_text.strip()[:800])
        if len(final_response_text) > 800:
            print(f"\n{c('... (truncated)', 'dim')}")

    return {
        "tools_used": tools_used,
        "final_response": final_response_text.strip()
    }


# =============================================================================
# HTTP API Test
# =============================================================================

async def test_swarm_http(query: str, session_id: str, base_url: str = "http://localhost:8000"):
    """Test Swarm via HTTP API (SSE stream)."""
    import aiohttp

    print(f"{c('Query:', 'bold')} {query}")
    print(f"{c('URL:', 'dim')} {base_url}/invocations")
    print()

    # Request body (matches InvocationInput schema)
    request_body = {
        "input": {
            "user_id": "test-user",
            "session_id": session_id,
            "message": query,
            "swarm": True  # Enable swarm mode
        }
    }

    print_header("Request Body")
    print(json.dumps(request_body, indent=2))

    print_header("SSE Events")

    node_history = []
    final_response = ""

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{base_url}/invocations",
            json=request_body,
            headers={"Content-Type": "application/json"}
        ) as response:
            if response.status != 200:
                print(f"{c('Error:', 'red')} HTTP {response.status}")
                text = await response.text()
                print(text)
                return

            # Parse SSE stream
            async for line in response.content:
                line = line.decode('utf-8').strip()
                if not line or not line.startswith('data: '):
                    continue

                try:
                    data = json.loads(line[6:])
                    event_type = data.get('type', 'unknown')

                    # Print event
                    if event_type == "swarm_node_start":
                        print(f"\n{c('[NODE START]', 'green')} {c(data.get('node_id', '?'), 'bold')}")
                        node_history.append(data.get('node_id'))

                    elif event_type == "swarm_node_stop":
                        print(f"{c('[NODE STOP]', 'yellow')} {data.get('node_id')} → {data.get('status')}")

                    elif event_type == "swarm_handoff":
                        print(f"{c('[HANDOFF]', 'cyan')} {data.get('from_node')} → {data.get('to_node')}")

                    elif event_type == "swarm_complete":
                        print(f"\n{c('[COMPLETE]', 'green')} {data.get('status')}")
                        print(f"  Nodes: {data.get('node_history')}")

                    elif event_type == "response":
                        # Responder streaming text
                        text = data.get('text', '')
                        final_response += text
                        print(text, end='', flush=True)

                    elif event_type == "text":
                        # Intermediate agent text (for progress)
                        pass

                    elif event_type in ("tool_use", "tool_result"):
                        tool_name = data.get('name', data.get('tool_use_id', '?'))
                        print(f"  {c('[TOOL]', 'magenta')} {tool_name}")

                except json.JSONDecodeError:
                    continue

    print_header("Summary")
    print(f"{c('Node History:', 'bold')} {' → '.join(node_history)}")
    print()

    if final_response.strip():
        print_header("Final Response")
        print(final_response.strip()[:500])


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Test Swarm Multi-Agent Orchestration",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_swarm.py                    # Run default (simple) scenario
  python test_swarm.py --scenario weather # Run weather scenario
  python test_swarm.py --query "Hello!"   # Custom query
  python test_swarm.py --http             # Test via HTTP API
  python test_swarm.py --list             # List available scenarios
        """
    )
    parser.add_argument("--query", help="Custom query to test")
    parser.add_argument("--scenario", choices=list(SCENARIOS.keys()), default="simple")
    parser.add_argument("--session-id", default="test-swarm-001")
    parser.add_argument("--user-id", default="test-user")
    parser.add_argument("--http", action="store_true", help="Test via HTTP API instead of direct")
    parser.add_argument("--url", default="http://localhost:8000", help="Base URL for HTTP test")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")

    args = parser.parse_args()

    if args.list:
        print_header("Available Test Scenarios")
        for key, s in SCENARIOS.items():
            print(f"  {c(key, 'bold')}: {s['name']}")
            print(f"    {c('Query:', 'dim')} {s['query']}")
            print(f"    {c('Expected:', 'dim')} {' → '.join(s['expected_agents'])}")
            print(f"    {s['description']}")
            print()
        return 0

    # Get query
    if args.query:
        query = args.query
        scenario_name = "Custom Query"
    else:
        scenario = SCENARIOS[args.scenario]
        query = scenario["query"]
        scenario_name = scenario["name"]

    print_header(f"Swarm Test: {scenario_name}")

    try:
        if args.http:
            # Test via HTTP API
            asyncio.run(test_swarm_http(
                query=query,
                session_id=args.session_id,
                base_url=args.url
            ))
        else:
            # Direct SDK test
            asyncio.run(test_swarm_direct(
                query=query,
                session_id=args.session_id,
                user_id=args.user_id,
                verbose=args.verbose
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
