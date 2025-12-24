#!/usr/bin/env python3
"""
Test simplified tool names
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
    print("🧪 Testing Simplified Tool Names")
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
        
        print(f"\n✅ Loaded {len(tools)} tools:")
        for tool in tools:
            print(f"\n📋 Tool: {tool.tool_name}")
            print(f"   Spec name: {tool.tool_spec['name']}")
            print(f"   Description: {tool.tool_spec['description'][:80]}...")
        
        # Check mapping
        print(f"\n🔄 Tool name mapping:")
        if hasattr(filtered_client, '_tool_name_map'):
            for simple, full in filtered_client._tool_name_map.items():
                print(f"   {simple} → {full}")
        
        print("\n" + "=" * 60)
        print("✅ Test completed!")
        print("=" * 60)

if __name__ == "__main__":
    main()
