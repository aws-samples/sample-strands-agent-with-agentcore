#!/usr/bin/env python3
"""
AgentCore A2A (Agent-to-Agent) Integration Test

Tests the deployed A2A agents using the actual project code:
- a2a_tools.py: A2A agent configuration and communication
- gateway_auth.py: SigV4 authentication
- Strands Agent with A2A tools

Usage:
    python scripts/test_a2a.py
    python scripts/test_a2a.py --list-only
    python scripts/test_a2a.py --agent research
    python scripts/test_a2a.py --agent browser
"""

import argparse
import asyncio
import sys
import os

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

from a2a_tools import (
    A2A_AGENTS_CONFIG,
    get_cached_agent_arn,
    send_a2a_message,
    create_a2a_tool
)

# Configuration from environment
REGION = os.environ.get('AWS_REGION', 'us-west-2')


def test_list_agents():
    """Test listing all configured A2A agents."""
    print("\n📋 Test: List All A2A Agents")
    print("─" * 50)

    try:
        print(f"✅ Found {len(A2A_AGENTS_CONFIG)} A2A agents:")

        for agent_id, config in A2A_AGENTS_CONFIG.items():
            name = config['name']
            desc = config['description'][:60].replace('\n', ' ')
            ssm_param = config['runtime_arn_ssm']
            print(f"   • {agent_id}")
            print(f"     Name: {name}")
            print(f"     Description: {desc}...")
            print(f"     SSM Parameter: {ssm_param}")
            print()

        return True

    except Exception as e:
        print(f"❌ Error listing agents: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_agent_arn_resolution(agent_id: str = None):
    """Test resolving agent ARN from SSM."""
    print("\n🔍 Test: Agent ARN Resolution")
    print("─" * 50)

    agents_to_test = [agent_id] if agent_id else list(A2A_AGENTS_CONFIG.keys())

    all_success = True
    for aid in agents_to_test:
        if aid not in A2A_AGENTS_CONFIG:
            print(f"⚠️  Unknown agent: {aid}")
            continue

        try:
            arn = get_cached_agent_arn(aid, REGION)
            if arn:
                print(f"✅ {aid}")
                print(f"   ARN: {arn[:60]}...")
            else:
                print(f"❌ {aid}: Failed to resolve ARN")
                all_success = False

        except Exception as e:
            print(f"❌ {aid}: Error - {e}")
            all_success = False

    return all_success


def test_create_a2a_tool(agent_id: str = None):
    """Test creating A2A tool (same as ChatbotAgent uses)."""
    print("\n🔧 Test: Create A2A Tool")
    print("─" * 50)

    agents_to_test = [agent_id] if agent_id else list(A2A_AGENTS_CONFIG.keys())

    all_success = True
    for aid in agents_to_test:
        if aid not in A2A_AGENTS_CONFIG:
            print(f"⚠️  Unknown agent: {aid}")
            continue

        try:
            tool = create_a2a_tool(aid)
            if tool:
                print(f"✅ {aid}")
                print(f"   Tool Name: {tool.__name__}")
                print(f"   Callable: {callable(tool)}")
            else:
                print(f"❌ {aid}: Failed to create tool")
                all_success = False

        except Exception as e:
            print(f"❌ {aid}: Error - {e}")
            import traceback
            traceback.print_exc()
            all_success = False

    return all_success


async def test_a2a_message_async(agent_id: str, message: str):
    """Test sending a message to A2A agent (async)."""
    print(f"\n📨 Test: Send A2A Message to {agent_id}")
    print("─" * 50)

    if agent_id not in A2A_AGENTS_CONFIG:
        print(f"⚠️  Unknown agent: {agent_id}")
        return False

    try:
        print(f"   Message: {message[:100]}...")
        print(f"   Region: {REGION}")
        print(f"   Waiting for response...")
        print()

        event_count = 0
        final_result = None

        async for event in send_a2a_message(
            agent_id=agent_id,
            message=message,
            session_id=f"test-session-{os.urandom(8).hex()}",
            region=REGION,
            metadata={"source": "integration_test", "user_id": "test-user"}
        ):
            event_count += 1
            event_type = event.get('type') or event.get('status', 'unknown')
            print(f"   [{event_count}] Event: {event_type}")

            if event_type == 'browser_session_detected':
                print(f"       Browser Session: {event.get('browserSessionId', 'N/A')[:50]}...")

            if event_type == 'browser_step':
                step_num = event.get('stepNumber', '?')
                content = event.get('content', '')[:50]
                print(f"       Step {step_num}: {content}...")

            final_result = event

        if final_result:
            status = final_result.get('status', 'unknown')
            if status == 'success':
                content = final_result.get('content', [{}])[0].get('text', '')
                print(f"\n✅ Response received ({len(content)} chars):")
                print(f"   {content[:200]}...")
                return True
            elif status == 'error':
                error = final_result.get('content', [{}])[0].get('text', 'Unknown error')
                print(f"\n❌ Error: {error}")
                return False
            else:
                print(f"\n⚠️  Unknown status: {status}")
                return True
        else:
            print(f"\n❌ No response received")
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_a2a_message(agent_id: str, message: str):
    """Wrapper for async test."""
    return asyncio.run(test_a2a_message_async(agent_id, message))


def main():
    parser = argparse.ArgumentParser(description="Test AgentCore A2A Agents")
    parser.add_argument("--list-only", action="store_true", help="Only list agents")
    parser.add_argument("--agent", type=str, choices=['research', 'browser'], help="Agent to test")
    parser.add_argument("--skip-message", action="store_true", help="Skip message test (to avoid long waits)")
    args = parser.parse_args()

    print("╔═══════════════════════════════════════════════════╗")
    print("║       AgentCore A2A Integration Test              ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    print(f"📍 Region: {REGION}")
    print(f"🔧 Configured Agents: {len(A2A_AGENTS_CONFIG)}")

    # Map short names to full agent IDs
    agent_map = {
        'research': 'agentcore_research-agent',
        'browser': 'agentcore_browser-use-agent'
    }

    agent_id = agent_map.get(args.agent) if args.agent else None

    results = []

    # Test 1: List all agents
    results.append(("List A2A Agents", test_list_agents()))

    if args.list_only:
        print("\n✅ List completed (--list-only mode)")
        return

    # Test 2: ARN resolution
    results.append(("ARN Resolution", test_agent_arn_resolution(agent_id)))

    # Test 3: Tool creation
    results.append(("Tool Creation", test_create_a2a_tool(agent_id)))

    # Test 4: Message test (optional, can be slow)
    if not args.skip_message:
        test_agent = agent_id or 'agentcore_research-agent'

        if test_agent == 'agentcore_research-agent':
            test_message = """Research Plan: Quick Test

Objectives:
- Verify A2A communication works

Topics:
1. What is AWS Lambda?

Structure:
- Brief overview (1 paragraph max)
"""
        else:
            test_message = "Go to example.com and tell me the page title"

        print(f"\n⚠️  Message test will invoke actual agent (may take 1-2 minutes)")
        results.append(("A2A Message", test_a2a_message(test_agent, test_message)))
    else:
        print("\n⏭️  Skipping message test (--skip-message)")

    # Summary
    print()
    print("═" * 50)
    print("📊 Test Summary")
    print("─" * 50)

    all_passed = True
    for name, passed in results:
        status = "✅" if passed else "❌"
        print(f"   {status} {name}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print("✅ All A2A tests passed!")
    else:
        print("⚠️  Some A2A tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
