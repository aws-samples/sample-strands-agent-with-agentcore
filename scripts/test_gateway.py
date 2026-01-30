#!/usr/bin/env python3
"""
AgentCore Gateway Integration Test

Tests the deployed Gateway using the actual project code:
- gateway_mcp_client.py: MCP client creation and tool filtering
- gateway_auth.py: SigV4 authentication
- Strands Agent with Gateway tools

Usage:
    python scripts/test_gateway.py
    python scripts/test_gateway.py --list-only
    python scripts/test_gateway.py --tool wikipedia
    python scripts/test_gateway.py --with-agent  # Include agent test
"""

import argparse
import sys
import os

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

from agent.gateway_mcp_client import (
    create_gateway_mcp_client,
    create_filtered_gateway_client,
    get_gateway_url_from_ssm,
    GATEWAY_ENABLED
)
from agent.gateway_auth import get_gateway_region_from_url


def test_list_tools():
    """Test listing all Gateway tools."""
    print("\n📋 Test: List All Gateway Tools")
    print("─" * 50)

    client = create_gateway_mcp_client()
    if not client:
        print("❌ Failed to create Gateway client")
        return False, []

    try:
        with client:
            tools = client.list_tools_sync()
            print(f"✅ Found {len(tools)} tools:")

            for tool in tools[:10]:
                name = tool.tool_name
                # Use same approach as gateway_tools.py router
                desc = getattr(tool, 'tool_description', 'Gateway MCP tool')
                desc = str(desc)[:60]
                print(f"   • {name}")
                print(f"     {desc}...")

            if len(tools) > 10:
                print(f"   ... and {len(tools) - 10} more tools")

            return True, tools

    except Exception as e:
        print(f"❌ Error listing tools: {e}")
        import traceback
        traceback.print_exc()
        return False, []


def test_filtered_client(tool_pattern: str = "wikipedia"):
    """Test FilteredMCPClient with tool filtering."""
    print(f"\n🔍 Test: Filtered Gateway Client (pattern: {tool_pattern})")
    print("─" * 50)

    # First get all tools to find matching IDs
    client = create_gateway_mcp_client()
    if not client:
        return False

    try:
        with client:
            all_tools = client.list_tools_sync()
            matching_ids = [
                f"gateway_{t.tool_name}"
                for t in all_tools
                if tool_pattern.lower() in t.tool_name.lower()
            ]

        if not matching_ids:
            print(f"⚠️  No tools matching '{tool_pattern}' found")
            return True  # Not a failure

        print(f"   Found {len(matching_ids)} matching tools: {matching_ids[:3]}...")

        # Create filtered client
        filtered_client = create_filtered_gateway_client(matching_ids)
        if not filtered_client:
            print("❌ Failed to create filtered client")
            return False

        with filtered_client:
            filtered_tools = filtered_client.list_tools_sync()
            print(f"✅ Filtered client has {len(filtered_tools)} tools:")

            for tool in filtered_tools:
                print(f"   • {tool.tool_name}")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_tool_execution(tool_pattern: str = "wikipedia"):
    """Test actual tool execution through Gateway."""
    print(f"\n🔧 Test: Tool Execution")
    print("─" * 50)

    client = create_gateway_mcp_client()
    if not client:
        return False

    try:
        with client:
            tools = client.list_tools_sync()

            # Find a searchable tool
            test_tool = None
            test_args = {}

            for tool in tools:
                name = tool.tool_name.lower()

                if "wikipedia" in name and "search" in name:
                    test_tool = tool.tool_name
                    test_args = {"query": "AWS Lambda"}
                    break
                elif "arxiv" in name and "search" in name:
                    test_tool = tool.tool_name
                    test_args = {"query": "machine learning", "max_results": 2}
                    break

            if not test_tool:
                print("⚠️  No suitable test tool found (need wikipedia_search or arxiv_search)")
                return True

            print(f"   Calling: {test_tool}")
            print(f"   Args: {test_args}")

            result = client.call_tool_sync(
                tool_use_id="test-execution-001",
                name=test_tool,
                arguments=test_args
            )

            print(f"✅ Tool executed successfully!")
            if result.get('content'):
                text = result['content'][0].get('text', '')[:200]
                print(f"   Response preview: {text}...")

            return True

    except Exception as e:
        print(f"❌ Error executing tool: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_agent_with_gateway_tools(tool_pattern: str = "wikipedia"):
    """Test Strands Agent using Gateway tools (Claude selects and executes tools)."""
    print(f"\n🤖 Test: Agent with Gateway Tools")
    print("─" * 50)

    try:
        from strands import Agent
    except ImportError:
        print("❌ Strands SDK not available")
        return False

    # Create filtered client with specific tools
    client = create_gateway_mcp_client()
    if not client:
        return False

    try:
        with client:
            all_tools = client.list_tools_sync()

            # Filter tools matching pattern
            matching_tools = [
                t for t in all_tools
                if tool_pattern.lower() in t.tool_name.lower()
            ]

            if not matching_tools:
                print(f"⚠️  No tools matching '{tool_pattern}' - using first 3 tools")
                matching_tools = all_tools[:3]

            print(f"   Using {len(matching_tools)} tools: {[t.tool_name for t in matching_tools]}")

            # Create agent with Haiku 4.5 (same model ID as agent.py default)
            agent = Agent(
                tools=matching_tools,
                model="eu.anthropic.claude-haiku-4-5-20251001-v1:0"
            )

            print(f"   Model: Claude Haiku 4.5")
            print(f"   Query: 'Search for information about AWS Lambda'")
            print()

            # Let the agent decide which tool to use
            response = agent("Search for information about AWS Lambda and give me a brief summary")

            # Extract response text
            if response.message and response.message.get('content'):
                for content_block in response.message['content']:
                    if content_block.get('text'):
                        response_text = content_block['text']
                        print(f"✅ Agent response ({len(response_text)} chars):")
                        print(f"   {response_text[:300]}...")
                        break
            else:
                print(f"✅ Agent completed (no text response)")

            return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Test AgentCore Gateway")
    parser.add_argument("--list-only", action="store_true", help="Only list tools")
    parser.add_argument("--tool", type=str, default="wikipedia", help="Tool pattern to test")
    parser.add_argument("--with-agent", action="store_true", help="Include agent test (uses Claude Haiku 4.5)")
    args = parser.parse_args()

    print("╔═══════════════════════════════════════════════════╗")
    print("║       AgentCore Gateway Integration Test          ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    # Check if Gateway is enabled
    print(f"🔧 Gateway Enabled: {GATEWAY_ENABLED}")

    # Get Gateway URL
    gateway_url = get_gateway_url_from_ssm()
    if not gateway_url:
        print("❌ Cannot proceed without Gateway URL")
        sys.exit(1)

    print(f"🌐 Gateway URL: {gateway_url[:60]}...")
    print(f"📍 Region: {get_gateway_region_from_url(gateway_url)}")

    results = []

    # Test 1: List all tools
    success, tools = test_list_tools()
    results.append(("List All Tools", success))

    if args.list_only:
        print("\n✅ List completed (--list-only mode)")
        return

    # Test 2: Filtered client
    results.append(("Filtered Client", test_filtered_client(args.tool)))

    # Test 3: Tool execution
    results.append(("Tool Execution", test_tool_execution(args.tool)))

    # Test 4: Agent with Gateway tools (optional)
    if args.with_agent:
        results.append(("Agent with Tools", test_agent_with_gateway_tools(args.tool)))

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
        print("✅ All Gateway tests passed!")
    else:
        print("⚠️  Some Gateway tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
