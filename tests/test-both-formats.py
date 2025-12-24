#!/usr/bin/env python3
"""
Test both full and simplified tool name formats
"""
import sys
sys.path.insert(0, '../chatbot-app/agentcore/src')

import boto3
from mcp.client.streamable_http import streamablehttp_client
from agent.gateway_mcp_client import FilteredMCPClient
from agent.gateway_auth import get_sigv4_auth, get_gateway_region_from_url

REGION = 'us-west-2'
PROJECT_NAME = 'strands-agent-chatbot'
ENVIRONMENT = 'dev'

def get_gateway_url():
    ssm = boto3.client('ssm', region_name=REGION)
    response = ssm.get_parameter(Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/mcp/gateway-url')
    return response['Parameter']['Value']

def test_format(enabled_tool_ids, format_name):
    print(f"\n{'='*60}")
    print(f"🧪 Testing {format_name}")
    print(f"{'='*60}")
    print(f"Enabled tool IDs: {enabled_tool_ids}")
    
    gateway_url = get_gateway_url()
    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)
    
    filtered_client = FilteredMCPClient(
        lambda: streamablehttp_client(gateway_url, auth=auth),
        enabled_tool_ids=enabled_tool_ids,
        prefix='gateway'
    )
    
    with filtered_client:
        tools = filtered_client.list_tools_sync()
        
        print(f"\n✅ Filtered {len(tools)} tools:")
        for tool in tools:
            print(f"   • {tool.tool_name} (spec: {tool.tool_spec['name']})")
        
        if len(tools) == 0:
            print("❌ FAILED: No tools matched!")
            return False
        else:
            print(f"✅ SUCCESS: {len(tools)} tools matched!")
            return True

def main():
    print("="*60)
    print("🧪 Testing Tool Name Format Compatibility")
    print("="*60)
    
    # Test 1: Full format (traditional)
    success1 = test_format(
        ['gateway_search-places___search_places'],
        "Full Format (gateway_search-places___search_places)"
    )
    
    # Test 2: Simplified format (new)
    success2 = test_format(
        ['gateway_search_places'],
        "Simplified Format (gateway_search_places)"
    )
    
    # Test 3: Mixed formats
    success3 = test_format(
        ['gateway_search_places', 'gateway_wikipedia-search___wikipedia_search'],
        "Mixed Format"
    )
    
    print(f"\n{'='*60}")
    print("📊 Summary:")
    print(f"{'='*60}")
    print(f"Full format: {'✅ PASS' if success1 else '❌ FAIL'}")
    print(f"Simplified format: {'✅ PASS' if success2 else '❌ FAIL'}")
    print(f"Mixed format: {'✅ PASS' if success3 else '❌ FAIL'}")
    
    if success1 and success2 and success3:
        print("\n🎉 All tests passed! Both formats are supported.")
    else:
        print("\n❌ Some tests failed.")

if __name__ == "__main__":
    main()
