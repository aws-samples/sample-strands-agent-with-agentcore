#!/usr/bin/env python3
"""
Test Agent with simplified tool names
"""
import sys
sys.path.insert(0, '../chatbot-app/agentcore/src')

import asyncio
import boto3
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from agent.gateway_mcp_client import FilteredMCPClient
from agent.gateway_auth import get_sigv4_auth, get_gateway_region_from_url

REGION = 'us-west-2'
PROJECT_NAME = 'strands-agent-chatbot'
ENVIRONMENT = 'dev'

def get_gateway_url():
    ssm = boto3.client('ssm', region_name=REGION)
    response = ssm.get_parameter(Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/mcp/gateway-url')
    return response['Parameter']['Value']

async def test():
    gateway_url = get_gateway_url()
    region = get_gateway_region_from_url(gateway_url)
    auth = get_sigv4_auth(region=region)
    
    enabled_tool_ids = [
        'gateway_search-places___search_places'
    ]
    
    filtered_client = FilteredMCPClient(
        lambda: streamablehttp_client(gateway_url, auth=auth),
        enabled_tool_ids=enabled_tool_ids,
        prefix='gateway'
    )
    
    agent = Agent(
        tools=[filtered_client],
        model='us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    )
    
    print("=" * 60)
    print("🧪 Testing Agent with Simplified Tool Names")
    print("=" * 60)
    print("\nQuery: Search for cafes in Gangnam Seoul\n")
    
    response = agent('Search for cafes in Gangnam Seoul')
    print("\n✅ Response received!")
    print(f"Tool calls: {[block.get('name') for block in response.message['content'] if block.get('type') == 'toolUse']}")
    print(f"\nResponse preview: {response.message['content'][0]['text'][:200]}...")

asyncio.run(test())
