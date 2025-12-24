#!/usr/bin/env python3
"""
Check what tool spec is actually sent to Claude/Bedrock
"""
import sys
sys.path.insert(0, '../chatbot-app/agentcore/src')

import boto3
from mcp.client.streamable_http import streamablehttp_client
from agent.gateway_mcp_client import FilteredMCPClient
from agent.gateway_auth import get_sigv4_auth, get_gateway_region_from_url
import json

REGION = 'us-west-2'
PROJECT_NAME = 'strands-agent-chatbot'
ENVIRONMENT = 'dev'

def get_gateway_url():
    ssm = boto3.client('ssm', region_name=REGION)
    response = ssm.get_parameter(Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/mcp/gateway-url')
    return response['Parameter']['Value']

def main():
    print("=" * 60)
    print("🔍 Checking Tool Spec Sent to Bedrock/Claude")
    print("=" * 60)
    
    gateway_url = get_gateway_url()
    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)
    
    enabled_tool_ids = [
        'gateway_search-places___search_places',
        'gateway_wikipedia-search___wikipedia_search'
    ]
    
    filtered_client = FilteredMCPClient(
        lambda: streamablehttp_client(gateway_url, auth=auth),
        enabled_tool_ids=enabled_tool_ids,
        prefix='gateway'
    )
    
    with filtered_client:
        tools = filtered_client.list_tools_sync()
        
        # Find search-places tool
        search_tool = None
        for tool in tools:
            if 'search-places' in tool.tool_name or 'search_places' in tool.tool_name:
                search_tool = tool
                break
        
        if not search_tool:
            print("❌ Tool not found")
            return
        
        print(f"\n✅ Found tool: {search_tool.tool_name}")
        print("\n📋 Tool Spec (sent to Bedrock):")
        print("-" * 60)
        
        # Get the tool spec that will be sent to Bedrock
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
