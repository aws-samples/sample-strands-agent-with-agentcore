#!/usr/bin/env python3
"""
Check what tool spec is actually sent to Claude/Bedrock
"""
import sys
sys.path.insert(0, '../chatbot-app/agentcore/src')

from agent.gateway_mcp_client import create_gateway_mcp_client
import json

def main():
    print("=" * 60)
    print("🔍 Checking Tool Spec Sent to Bedrock/Claude")
    print("=" * 60)

    client = create_gateway_mcp_client()
    if not client:
        print("❌ Failed to create client")
        return

    with client:
        tools = client.list_tools_sync()

        # Find search-places tool
        search_tool = None
        for tool in tools:
            if tool.tool_name == 'search-places___search_places':
                search_tool = tool
                break

        if not search_tool:
            print("❌ Tool not found")
            return

        print(f"\n✅ Found tool: {search_tool.tool_name}")
        print("\n📋 Tool Spec (sent to Bedrock):")
        print("-" * 60)

        spec = search_tool.tool_spec
        print(json.dumps(spec, indent=2))

        print("\n" + "=" * 60)
        print("🔑 Key Observations:")
        print("=" * 60)

        tool_name_in_spec = spec.get("name")
        print(f"1. Tool name in spec: '{tool_name_in_spec}'")

        if '___' in tool_name_in_spec:
            parts = tool_name_in_spec.split('___')
            print(f"   → Full name format: {parts[0]} + {parts[1]}")
        else:
            print(f"   → Short name format (no ___)")

        print(f"\n2. MCP tool.tool_name: '{search_tool.tool_name}'")

        if hasattr(search_tool, 'mcp_tool'):
            mcp_name = search_tool.mcp_tool.name
            print(f"3. MCP protocol name: '{mcp_name}'")
            if mcp_name != tool_name_in_spec:
                print(f"   ⚠️  MISMATCH: MCP name != Bedrock spec name")

        print("\n" + "=" * 60)
        print("📊 Conclusion:")
        print("=" * 60)

        if tool_name_in_spec == search_tool.tool_name:
            print("✅ Tool spec uses FULL name")
            print("   → Claude should use full name")
            print("   → If Claude uses short name, it's Bedrock transformation")
        else:
            print("⚠️  Tool spec uses different name than registry")
            print(f"   Spec: {tool_name_in_spec}")
            print(f"   Registry: {search_tool.tool_name}")

if __name__ == "__main__":
    main()
